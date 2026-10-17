// PARAMETERS NEEDED TO VERIFY A STORED PASSWORD
export interface PasswordRecord {
  algorithm: "scrypt";
  version: 1;
  salt: string;
  hash: string;
  parameters: {
    N: number;
    r: number;
    p: number;
    keyLength: number;
  };
}

// PRIVATE ACCOUNT RECORD LINKED TO A PUBLIC USER
export interface AccountDocument {
  _id: string;
  username: string;
  role: "user" | "admin";
  password: PasswordRecord;
}

// SERVER-SIDE SESSION RECORD
export interface SessionDocument {
  _id: string;
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
}

// TRUSTED IDENTITY SUPPLIED TO APPLICATION SERVICES
export interface Actor {
  userId: string;
  role: "user" | "admin";
}

// RETURNED TO THE CALLER; NEVER STORED OR LOGGED AS A WHOLE
export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthenticatedIdentity extends Actor {
  name: string;
}
