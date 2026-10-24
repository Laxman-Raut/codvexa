import { tool } from "@langchain/core/tools";
import { createFile, createFolder, deleteFile, getFile, getTree, updateFile } from "../utils/fetchFileApis.js";
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


const createFileTool = tool(
    async ({ name, parentId, content, language }) => {
        console.log("AI TOOL - createFile");

        try {
            const file = await createFile(
                userId,
                projectId,
                name,
                parentId || null,
                content ?? "",
                language || "plaintext"
            );

            if (!file) {
                return JSON.stringify({
                    success: false,
                    error: "File could not be created."
                });
            }

            return JSON.stringify({
                success: true,
                operation: "file_created",
                file: {
                    _id: file._id,
                    name: file.name,
                    type: file.type,
                    language: file.language,
                    parentId: file.parentId
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
        description: `Create a NEW FILE in the project.
RULES:
1. Use get_tree first when the project structure is unknown.
2. Use the exact folder _id as parentId (from get_tree or a previous create_folder result).
3. Omit parentId (or pass null) to create the file at the project root.
4. Never create duplicate files.
5. Send the complete file content.
6. Create folders before the files inside them.
7. Never use terminal commands to create files.
8. Do not call get_file immediately after creating a file.
9. Continue creating all required files. Do not stop after creating only one file.`,
        schema: z.object({
            name: z.string().describe("Name of the file, including extension (e.g. App.jsx)"),
            language: z
                .string()
                .optional()
                .describe("Language of the file, e.g. javascript, python, html. Defaults to plaintext"),
            content: z.string().describe("The complete content of the file"),
            parentId: z
                .string()
                .nullable()
                .optional()
                .describe("The _id of the parent folder, or null/omitted for the project root")
        })
    }
);

const updateFileTool = tool(
    async ({ fileId, content, name }) => {
        console.log("AI TOOL - updateFile");

        try {
            const file = await updateFile(userId, projectId, fileId, {
                content,
                ...(name ? { name } : {})
            });

            if (!file) {
                return JSON.stringify({
                    success: false,
                    error: "File not found or could not be updated."
                });
            }

            if (file.type !== "file") {
                return JSON.stringify({
                    success: false,
                    error: "The provided ID belongs to a folder, not a file.",
                    instruction: "Do not call update_file for a folder."
                });
            }

            return JSON.stringify({
                success: true,
                operation: "file_updated",
                file: {
                    _id: file._id,
                    name: file.name,
                    type: file.type,
                    language: file.language,
                    parentId: file.parentId
                }
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: err.message || "Failed to update file."
            });
        }
    },
    {
        name: "update_file",
        description: `Update an EXISTING FILE.
RULES:
1. Call get_file before updating.
2. fileId must be an actual file ID from get_tree.
3. NEVER use a folder ID.
4. Send the complete updated file content, not just the changed part.
5. Only pass name if the file should be renamed.
6. Do not update files that do not exist.
7. After a successful update, continue with the remaining work.
8. Do not call get_file again unless another modification is needed.`,
        schema: z.object({
            fileId: z.string().describe("The _id of the file (not a folder) from get_tree"),
            content: z.string().describe("The complete updated content of the file"),
            name: z
                .string()
                .optional()
                .describe("New file name including extension. Omit to keep the current name")
        })
    }
);

const deleteFileTool = tool(
    async ({ fileId }) => {
        console.log("AI TOOL - deleteFile");

        try {
            const file = await deleteFile(userId, projectId, fileId);

            if (!file) {
                return JSON.stringify({
                    success: false,
                    error: "File not found or could not be deleted."
                });
            }

            return JSON.stringify({
                success: true,
                operation: "file_deleted",
                file: {
                    _id: file._id,
                    name: file.name
                }
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: err.message || "Failed to delete file."
            });
        }
    },
    {
        name: "delete_file",
        description: `Permanently delete an EXISTING FILE.
RULES:
1. fileId must be an actual file ID from get_tree.
2. NEVER pass a folder ID. This tool cannot delete folders.
3. Only delete a file when the user asked for it or it is clearly required by the task.
4. Do not delete a file you just created unless the user asks.
5. Deletion cannot be undone.
6. After a successful delete, continue with the remaining work.
7. Do not call get_tree again just to verify the deletion.`,
        schema: z.object({
            fileId: z.string().describe("The _id of the file (not a folder) from get_tree")
        })
    }
);

return[
    getTreeTool,
    getFileTool,
    createFileTool,
    createFolderTool,
    updateFileTool,
    deleteFileTool
]
  
};