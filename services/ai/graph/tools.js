import { tool } from "@langchain/core/tools";
import { createFile, createFolder, getFile, getTree } from "../utils/fetchFileApis.js";
import z from "zod/v3";

const MAX_CONTENT_CHARS = 50000;

const compactTree = (items = []) => {
    return items.map((item) => ({
        _id: item._id,
        parentId: item.parentId,
        name: item.name,
        type: item.type,
        language: item.language,
        extension: item.extension,
        children: compactTree(item.children || [])
    }));
};

export const filetools = ({ projectId, userId }) => {
    const getTreeTool = tool(
        async () => {
            console.log("AI TOOL - getTREE");

            try {
                const result = await getTree(userId, projectId);
                const tree = compactTree(result);

                return JSON.stringify({
                    success: true,
                    tree
                });
            } catch (err) {
                return JSON.stringify({
                    success: false,
                    error: err.message || "Failed to fetch project tree."
                });
            }
        },
        {
            name: "get_tree",
            description: `Get the complete project file and folder tree.
IMPORTANT:
1. Use this when the project structure is unknown.
2. Do not repeatedly call get_tree.
3. type="folder" means folder.
4. type="file" means file.
5. Folder IDs are used as parentId.
6. NEVER call get_file with a folder ID.
7. Do not use terminal commands to inspect the project.
8. Use the exact IDs returned by this tool.
The tree contains: _id, parentId, name, type, language, extension, children.`,
            schema: z.object({})
        }
    );

    const getFileTool = tool(
        async ({ fileId }) => {
            console.log("AI TOOL - getFile");

            try {
                const file = await getFile(userId, fileId);

                if (!file) {
                    return JSON.stringify({
                        success: false,
                        error: "File not found."
                    });
                }

                // Make sure the file belongs to the current project
                if (file.projectId && String(file.projectId) !== String(projectId)) {
                    return JSON.stringify({
                        success: false,
                        error: "File does not belong to this project."
                    });
                }

                if (file.type !== "file") {
                    return JSON.stringify({
                        success: false,
                        error: "The provided ID belongs to a folder, not a file.",
                        instruction: "Do not call get_file for a folder. Use the folder as parentId."
                    });
                }

                const content = file.content || "";
                const truncated = content.length > MAX_CONTENT_CHARS;

                return JSON.stringify({
                    success: true,
                    file: {
                        _id: file._id,
                        name: file.name,
                        content: truncated ? content.slice(0, MAX_CONTENT_CHARS) : content,
                        truncated,
                        type: file.type,
                        language: file.language,
                        extension: file.extension,
                        parentId: file.parentId
                    }
                });
            } catch (err) {
                return JSON.stringify({
                    success: false,
                    error: err.message || "Failed to fetch file."
                });
            }
        },
        {
            name: "get_file",
            description: `Read an EXISTING FILE's content.
STRICT RULES:
1. fileId must belong to a file.
2. NEVER pass a folder ID.
3. Use exact file ID from get_tree.
4. Read a file before suggesting changes to it.
5. Do not call this repeatedly for the same file.
6. If "truncated" is true, the content was cut off because the file is large.`,
            schema: z.object({
                fileId: z.string().describe("The _id of the file (not a folder) from get_tree")
            })
        }
    );


const createFolderTool = tool(
    async ({ name, parentId }) => {
        console.log("AI TOOL - createFolder");

        try {
            const folder = await createFolder(userId, projectId, name, parentId || null);

            if (!folder) {
                return JSON.stringify({
                    success: false,
                    error: "Folder could not be created."
                });
            }

            return JSON.stringify({
                success: true,
                operation: "folder_created",
                folder: {
                    _id: folder._id,
                    name: folder.name,
                    type: folder.type,
                    parentId: folder.parentId
                }
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: err.message || "Failed to create folder."
            });
        }
    },
    {
        name: "create_folder",
        description: `Create a new folder in the project.
RULES:
1. Create parent folders first, then their children.
2. Use the exact parentId from get_tree (or from a previous create_folder result).
3. Omit parentId (or pass null) to create the folder at the project root.
4. Never create duplicate folders. Check get_tree first.
5. A folder directly inside another folder must use that folder's _id as parentId.
6. After creation, continue with the remaining work.
7. Do not call get_tree again just to verify the folder; the result of this tool is enough.`,
        schema: z.object({
            name: z.string().describe("Name of the folder to create"),
            parentId: z
                .string()
                .nullable()
                .optional()
                .describe("The _id of the parent folder, or null/omitted for the project root")
        })
    }
);


const createFIleTool = tool(
    async ({ name, parentId ,content ,language }) => {
        console.log("AI TOOL - create_File");

        try {
            const folder = await createFile(userId, projectId, name, parentId , content , language:language||"plaintext");

            

            return JSON.stringify({
                success: true,
                operation: "file_created",
                file: {
                    _id: folder._id,
                    name: folder.name,
                    type: folder.type,
                    language: file.language,
                    content:file.content,

                    parentId: folder.parentId
                }
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: err.message || "Failed to create file."
            });
        }
    },
    {
        name: "create_file",
        description: `Create a NEW FILE.
RULES:
1. Use get tree first when project structure is unknown.
2. Use exact folder ID as parentId.
3. Never create duplicate files.
4. Send complete file content.
5. Create folders before files inside them.
6. Never use terminal commands to create files.
7. Do not call get_file immediately after creating a file.
8. Continue creating all required files.
9. Do not stop after creating only one file.`,
        schema: z.object({
            name: z.string().describe("Name of the folder to create"),
            parentId: z
                .string()
                .nullable()
                .optional()
                .describe("The _id of the parent folder, or null/omitted for the project root")
        })
    }
);



  
};