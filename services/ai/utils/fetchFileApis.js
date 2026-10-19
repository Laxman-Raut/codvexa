import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

export const createFolder = async (projectId, parentId, name, userId) => {
    const file_uri = process.env.FILE_SERVICE_URI;

    try {
        const { data } = await axios.post(
            `${file_uri}/create-folder`,
            { projectId, parentId, name, userId },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.log(error);
        throw error;
    }
};


export const createFile = async (
    projectId,
    parentId,
    userId,
    name,
    content = "",
    language = "plaintext"
) => {
    const file_uri = process.env.FILE_SERVICE_URI;

    try {
        const { data } = await axios.post(
            `${file_uri}/create-file`,
            { projectId, parentId, name, content, language },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.log(error);
        throw error;
    }
};


export const updateFile = async (
    userId,
    name,
    content = "",
    id
) => {
    const file_uri = process.env.FILE_SERVICE_URI;

    try {
        const { data } = await axios.put(
            `${file_uri}/${id}`,
            { name, content },
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.log(error);
        throw error;
    }
};

export const deleteFile = async (
    userId,
  
    id
) => {
    const file_uri = process.env.FILE_SERVICE_URI;

    try {
        const { data } = await axios.delete(
            `${file_uri}/${id}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.log(error);
        throw error;
    }
};


export const getTree= async (
    userId,
  
    projectId
) => {
    const file_uri = process.env.FILE_SERVICE_URI;

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
        console.log(error);
        throw error;
    }
};


export const getFile= async (
    userId,
  
    id
) => {
    const file_uri = process.env.FILE_SERVICE_URI;

    try {
        const { data } = await axios.get(
            `${file_uri}/${id}`,
            {
                headers: {
                    "x-user-id": String(userId)
                }
            }
        );

        return data;
    } catch (error) {
        console.log(error);
        throw error;
    }
};

