import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installAccessTransport } from "./lib/access-transport";
import { retryReadQuery } from "./lib/read-query-policy";

// Must run before the first backend call so access requests can use the same-origin relay.
installAccessTransport();

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: retryReadQuery } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
