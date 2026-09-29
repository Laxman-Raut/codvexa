import Project from "../model/project.model.js";
import redis from "../../../shared/redis/redis.js";

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

         const key = `projects-${userId}`

         await redis.del(key)

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
           
        const key = `projects-${userId}`
         let result = await redis.get(key)
         if(result){
          return res.status(200).json(JSON.parse(result));
         }



        const projects = await Project.find({
            owner: userId
            }).sort({ updatedAt: -1 });

         await redis.set(key,JSON.stringify(projects))
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

        if (!project) {
            return res.status(404).json({
                message: "project not found"
            });
        }

        project.lastOpenedAt = new Date();
        await project.save();

        return res.status(200).json(project);

    } catch (error) {
        return res.status(500).json({
            message: `get project error ${error.message}`
        });
    }
};

//for starred project

export const getstarredProjects = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];

        if (!userId) {
            return res.status(401).json({
                message: "user id is required"
            });
        }

        const key = `starred-projects-${userId}`
         let result = await redis.get(key)
         if(result){
          return res.status(200).json(JSON.parse(result));
         }

        const projects = await Project.find({
            owner: userId,
            starred:true
        }).sort({ updatedAt: -1 });
           await redis.set(key,JSON.stringify(projects))
        return res.status(200).json(projects);

    } catch (error) {
        return res.status(500).json({
            message: `get starred  projects error ${error.message}`
        });
    }
};
    
// starred toggle
export const togglestarred = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];

       

        const { id } = req.params;

        const project = await Project.findOne({
            _id: id,
            owner: userId
        });

        if (!project) {
            return res.status(404).json({
                message: "project was not found"
            });
        }

        project.starred = !project.starred;

        await project.save();
        await redis.set(key,JSON.stringify(projects))
        await redis.del(key)

        return res.status(200).json(project);

    } catch (error) {
        return res.status(500).json({
            message: `toggle starred project error ${error.message}`
        });
    }
};

// delete project


export const deleteproject= async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];

       

        const { id } = req.params;

        const project = await Project.findByIdAndDelete(id);

        if (!project) {
            return res.status(404).json({
                message: "project not found"
            });
        }

        await redis.del(key)

        return res.status(200).json(project);

    } catch (error) {
        return res.status(500).json({
            message: `delete project error ${error.message}`
        });
    }
};