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