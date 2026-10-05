import File from "../models/file.model.js";

export const createrootFolder = async (req, res) => {
  try {
    const { projectId, projectName } = req.body;
    const userId = req.headers["x-user-id"];

    if (!projectId || !projectName) {
      return res.status(400).json({
        message: "projectId and name is required"
      });
    }

    const existingRootfolder = await File.findOne({
      projectId,
      parentId: null,
      isdeleted: false
    });

    if (existingRootfolder) {
      return res.status(400).json({
        message: "root folder is already exist"
      });
    }

    const rootFolder = await File.create({
      owner: userId,
      name: projectName,
      projectId,
      type: "folder",
      parentId: null
    });

    return res.status(201).json(rootFolder);

  } catch (error) {
    return res.status(500).json({
      message: ` create root flder error{error.message}`
    });
  }
};

export const createFolder = async (req, res) => {
  try {
    const { projectId, name,parentId } = req.body;
    const userId = req.headers["x-user-id"];

    if (!projectId || !name || parentId) {
      return res.status(400).json({
        message: "projectId, parentId and name are  required"
      });
    }

    const exist= await File.findOne({
        name,
      projectId,
      parentId ,
      isdeleted: false
    });

    if (exist) {
      return res.status(400).json({
        message: " folder is already exist"
      });
    }

    const Folder = await File.create({
      owner: userId,
      name,
      projectId,
      type: "folder",
      parentId
    });

    return res.status(201).json(Folder);

  } catch (error) {
    return res.status(500).json({
      message: ` create  foder error{error.message}`
    });
  }
};

export const createFile = async (req, res) => {
  try {
    const {
      projectId,
      name,
      parentId,
      content = "",
      language = "plaintext"
    } = req.body;

    const userId = req.headers["x-user-id"];

    if (!projectId || !name) {
      return res.status(400).json({
        message: "projectId and name are required"
      });
    }

    const exist = await File.findOne({
      name,
      projectId,
      parentId: parentId || null,
      isdeleted: false
    });

    if (exist) {
      return res.status(400).json({
        message: "file already exists"
      });
    }

    const extension = name.includes(".")
      ? name.split(".").pop()
      : "";

    const file = await File.create({
      owner: userId,
      name,
      projectId,
      type: "file",
      parentId: parentId || null,
      language,
      content,
      extension,
      size: content.length
    });

    return res.status(201).json(file);

  } catch (error) {
    return res.status(500).json({
      message: `create file error ${error.message}`
    });
  }
};


export const updateFile = async (req, res) => {
  try {
    const {
      name,
      content
    } = req.body;

    const userId = req.headers["x-user-id"];

    const file = await File.findOne({
      _id: req.params.id,
      owner: userId,
      isdeleted: false
    });

    if (!file) {
      return res.status(404).json({
        message: "file not found"
      });
    }

    if (name) {
      file.name = name;

      const extension = name.includes(".")
        ? name.split(".").pop()
        : "";

      file.extension = extension;
    }

    if (content !== undefined) {
      file.content = content;
      file.size = content.length;
    }

    await file.save();

    return res.status(200).json(file);

  } catch (error) {
    return res.status(500).json({
      message: `update file error ${error.message}`
    });
  }
};