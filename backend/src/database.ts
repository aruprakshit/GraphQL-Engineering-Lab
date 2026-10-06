import { MongoClient } from "mongodb";

// 1. READ AND VALIDATE CONFIGURATION
const mongoUrl = process.env.MONGO_URL;
const databaseName = process.env.MONGO_DB;

if (!mongoUrl || !databaseName) {
  throw new Error("MONGO_URL and MONGO_DB must be configured");
}

// 2. CREATE ONE CLIENT FOR THIS APPLICATION PROCESS
export const mongoClient = new MongoClient(mongoUrl, {
  serverSelectionTimeoutMS: 3000,
});

// 3. SELECT THE DATABASE
export const database = mongoClient.db(databaseName);

// 4. CONNECT AND VERIFY THAT MONGODB RESPONDS
export async function connectDatabase(): Promise<void> {
  await mongoClient.connect();
  await database.command({ ping: 1 });

  console.log(`Connected to MongoDB database: ${database.databaseName}`);
}
