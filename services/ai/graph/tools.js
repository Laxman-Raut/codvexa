import { tool } from "@langchain/core/tools";
import { getFile, getTree } from "../utils/fetchFileApis.js";
import z from "zod/v3";

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

            const result = await getTree(userId, projectId);
            const tree = compactTree(result);

            return JSON.stringify({
                success: true,
                tree
            });
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

            const file = await getFile(userId, fileId);

            if (!file) {
                return JSON.stringify({
                    success: false,
                    error: "File not found."
                });
            }

            if (file.type !== "file") {
                return JSON.stringify({
                    success: false,
                    error: "The provided ID belongs to a folder, not a file.",
                    instruction: "Do not call get_file for a folder. Use the folder as parentId."
                });
            }

            return JSON.stringify({
                success: true,
                file: {
                    _id: file._id,
                    name: file.name,
                    content: file.content,
                    type: file.type,
                    language: file.language,
                    extension: file.extension,
                    parentId: file.parentId
                }
            });
        },
        {
            name: "get_file",
            description: `Read an EXISTING FILE before modifying it.
STRICT RULES:
1. fileId must belong to a file.
2. NEVER pass a folder ID.
3. Use exact file ID from get_tree.
4. Call this before update_file.
5. Do not call this for newly created files unless necessary.
6. Do not call this repeatedly for the same file.`,
            schema: z.object({
                fileId: z.string()
            })
        }
    );

    return [getTreeTool, getFileTool];
};