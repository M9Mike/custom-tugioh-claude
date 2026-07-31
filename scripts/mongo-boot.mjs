// Starts a throwaway MongoDB so the durable-storage path can be tested locally.
import { MongoMemoryServer } from 'mongodb-memory-server';
const server = await MongoMemoryServer.create({ instance: { port: 27099 } });
console.log('MONGO_READY', server.getUri());
process.stdin.resume();
