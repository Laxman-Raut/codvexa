export const create = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];

        if (!userId) {
            return res.status(401).json({
                message: "user id is required"
            });
        }

        const { name, description } = req.body;

        const project = await Project.create({
            owner: userId,
            name,
            description
        });

        return res.status(201).json(project);

    } catch (error) {
        return res.status(500).json({
            message: `create project error ${error.message}`
        });
    }
};

  //for getting alll project 
export const getprojects = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];

        if (!userId) {
            return res.status(401).json({
                message: "user id is required"
            });
        }

        const projects = await Project.find({
            owner: userId
        }).sort({ updatedAt: -1 });

        return res.status(200).json(projects);

    } catch (error) {
        return res.status(500).json({
            message: `get projects error ${error.message}`
        });
    }
};

// for getting one project
export const getprojectById = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];

        if (!userId) {
            return res.status(401).json({
                message: "user id is required"
            });
        }

        const { id } = req.params;

        const project = await Project.findById(id);
         project.lastOpenedAt=new Date()
         await project.save()
        if (!project) {
            return res.status(404).json({
                message: "project not found"
            });
        }

        return res.status(200).json(project);

    } catch (error) {
        return res.status(500).json({
            message: `get project error ${error.message}`
        });
    }
};