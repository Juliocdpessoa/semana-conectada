import {
  executeRsOperation,
  loadRsWeeks,
  loadCapacityJourney,
  saveCapacityJourney,
} from "./rs-transport.functions";
import { RS_MUTATIONS } from "./rs-transport-policy";
import {
  createRsRequest as request,
  type RsTransportResult as Result,
} from "./rs-transport-request";
export const rsTransport = {
  rpc(operation: string, params: Record<string, unknown>) {
    return request(
      (signal) => executeRsOperation({ data: { operation, params }, signal }) as Promise<Result>,
      RS_MUTATIONS.has(operation),
    );
  },
  weeks(worksiteId: string) {
    return request((signal) => loadRsWeeks({ data: { worksiteId }, signal }) as Promise<Result>);
  },
  journey(weekId: string) {
    return request(
      (signal) => loadCapacityJourney({ data: { weekId }, signal }) as Promise<Result>,
    );
  },
  saveJourney(weekId: string, version: number, days: Record<string, number>) {
    return request(
      (signal) =>
        saveCapacityJourney({ data: { weekId, version, days }, signal }) as Promise<Result>,
      true,
    );
  },
};
