import type { PublicProfile } from "./schemas.js";
export type { PublicProfile } from "./schemas.js";

export interface UserServiceClient {
  findProfiles(ids: readonly string[]): Promise<PublicProfile[]>;
}

export interface UserServiceClientOptions {
  baseUrl: string;
  serviceToken: string;
}
