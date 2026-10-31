import mongoose from 'mongoose';

export function createDatabase() {
  const connection = mongoose.createConnection();

  // Connection errors are handled by connect()/isAvailable(); never log the URI.
  connection.on('error', () => {});

  return {
    async connect(uri) {
      await connection.openUri(uri, {
        maxPoolSize: 5,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        bufferCommands: false,
        autoCreate: false,
        autoIndex: false,
      });
    },

    async isAvailable() {
      if (connection.readyState !== 1 || !connection.db) {
        return false;
      }

      try {
        const result = await connection.db.command({ ping: 1 }, { timeoutMS: 1500 });
        return result.ok === 1;
      } catch {
        return false;
      }
    },

    async close() {
      await connection.close();
    },
  };
}
