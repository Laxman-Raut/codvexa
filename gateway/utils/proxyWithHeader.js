import proxy from "express-http-proxy";

export const proxyWithHeader = (serviceUrl) => {
  return proxy(serviceUrl, {
    proxyReqOptDecorator: (proxyReqOpts, req) => {
      if (req.user?.userId) {
        proxyReqOpts.headers["x-user-id"] = req.user.userId.toString();
      }

      return proxyReqOpts;
    },
  });
};