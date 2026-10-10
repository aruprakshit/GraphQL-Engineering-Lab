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
