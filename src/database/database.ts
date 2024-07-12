import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function connectToDatabase() {
    try {
        await client.connect();
        console.log('Conexión establecida a la base de datos MongoDB');
        return client;
    } catch (error) {
        console.error('Error al conectar a la base de datos MongoDB:', error);
        throw error;
    }
}

export { connectToDatabase };
