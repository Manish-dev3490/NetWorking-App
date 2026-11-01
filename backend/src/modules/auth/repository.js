import { createAuthModels } from './models.js';

export function createAuthRepository(connection) {
  const { User, Session, SavedCollection } = createAuthModels(connection);
  return {
    transaction: (work) => connection.transaction(work),
    findByEmail: (email) => User.findOne({ emailNormalized: email }).select('+passwordHash').lean(),
    async createAccount(user, session, savedCollection, transaction) {
      await User.create([user], { session: transaction });
      await Session.create([session], { session: transaction });
      await SavedCollection.create([savedCollection], { session: transaction });
    },
    createSession: (session) => Session.create(session),
    findSession: (tokenHash) => Session.findOne({ tokenHash }).lean(),
    findUser: (id) => User.findById(id).lean(),
    deleteSession: (tokenHash) => Session.deleteOne({ tokenHash }),
    updateProfile: (id, authVersion, fields) => User.findOneAndUpdate(
      { _id: id, status: 'active', authVersion }, { $set: fields },
      { returnDocument: 'after', runValidators: true },
    ).lean(),
  };
}
