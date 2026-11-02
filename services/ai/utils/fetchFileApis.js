import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const getBaseUri = () =>
    (process.env.FILE_SERVICE_URI || "http://localhost:8003").replace(/\/+$/, "");

export const getTree = async (userId, projectId) => {
    const file_uri = getBaseUri();

    try {
        const { data } = await axios.get(
            `${file_uri}/tree/${projectId}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        if (error.response?.status === 404) {
            return [];
        }
        console.error("fetchFileApis getTree error:", error.response?.data || error.message);
        throw error;
    }
};

export const getFile = async (userId, projectIdOrFileId, maybeFileId) => {
    const file_uri = getBaseUri();
    const fileId = maybeFileId || projectIdOrFileId;

    try {
        const { data } = await axios.get(
            `${file_uri}/${fileId}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.error("fetchFileApis getFile error:", error.response?.data || error.message);
        throw error;
    }
};

const resolveRootFolderId = async (userId, projectId) => {
    try {
        const tree = await getTree(userId, projectId);
        if (Array.isArray(tree) && tree.length > 0) {
            const root =
                tree.find((item) => item.type === "folder" && !item.parentId) ||
                tree.find((item) => item.type === "folder");
            if (root?._id) return String(root._id);
        }

        // If no root folder exists in the project yet, auto-create one
        const file_uri = getBaseUri();
        const { data: rootFolder } = await axios.post(
            `${file_uri}/create-root-folder`,
            {
                projectId,
                projectName: "project"
            },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );
        if (rootFolder?._id) return String(rootFolder._id);
    } catch (err) {
        console.warn("Could not resolve or create root folder parentId:", err.response?.data || err.message);
    }
    return null;
};

export const createFolder = async (userId, projectId, name, parentId = null) => {
    const file_uri = getBaseUri();

    try {
        let effectiveParentId = parentId;
        if (!effectiveParentId) {
            effectiveParentId = await resolveRootFolderId(userId, projectId);
        }

        const cleanName = name ? String(name).replace(/^\/+|\/+$/g, "").trim() : name;

        const { data } = await axios.post(
            `${file_uri}/create-folder`,
            {
                projectId,
                parentId: effectiveParentId,
                name: cleanName
            },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.error("fetchFileApis createFolder error:", error.response?.data || error.message);
        throw error;
    }
};

export const createFile = async (
    userId,
    projectId,
    name,
    parentId = null,
    content = "",
    language = "plaintext"
) => {
    const file_uri = getBaseUri();

    try {
        let effectiveParentId = parentId;
        if (!effectiveParentId) {
            effectiveParentId = await resolveRootFolderId(userId, projectId);
        }

        const cleanName = name ? String(name).replace(/^\/+/, "").trim() : name;

        const { data } = await axios.post(
            `${file_uri}/create-file`,
            {
                projectId,
                parentId: effectiveParentId || null,
                name: cleanName,
                content: content ?? "",
                language: language || "plaintext"
            },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.error("fetchFileApis createFile error:", error.response?.data || error.message);
        throw error;
    }
};

export const updateFile = async (userId, projectIdOrFileId, fileIdOrUpdates, maybeUpdates) => {
    const file_uri = getBaseUri();

    let fileId;
    let updates = {};

    if (typeof fileIdOrUpdates === "object" && fileIdOrUpdates !== null) {
        fileId = projectIdOrFileId;
        updates = fileIdOrUpdates;
    } else if (maybeUpdates !== undefined && typeof maybeUpdates === "object" && maybeUpdates !== null) {
        fileId = fileIdOrUpdates;
        updates = maybeUpdates;
    } else {
        fileId = fileIdOrUpdates || projectIdOrFileId;
    }

    const payload = {};
    if (updates.name !== undefined) payload.name = String(updates.name).trim();
    if (updates.content !== undefined) payload.content = updates.content;

    try {
        const { data } = await axios.patch(
            `${file_uri}/${fileId}`,
            payload,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.error("fetchFileApis updateFile error:", error.response?.data || error.message);
        throw error;
    }
};

export const deleteFile = async (userId, projectIdOrFileId, maybeFileId) => {
    const file_uri = getBaseUri();
    const fileId = maybeFileId || projectIdOrFileId;

    try {
        const { data } = await axios.delete(
            `${file_uri}/${fileId}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.error("fetchFileApis deleteFile error:", error.response?.data || error.message);
        throw error;
    }
};
