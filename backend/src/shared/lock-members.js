export async function lockMembers(users, actorId, targetId, { session, projection, restricted, notFound }) {
  const ids = actorId.equals(targetId) ? [actorId] : [actorId, targetId].sort((a, b) => a.toHexString().localeCompare(b.toHexString()));
  const members = new Map();
  // Graph, privacy and engagement writes share the same guards. Acquire them
  // in ID order so concurrent writes retry against the latest policy.
  for (const id of ids) {
    const member = await users.findOneAndUpdate({ _id: id, status: 'active' }, { $inc: { policyVersion: 1 } },
      { session, returnDocument: 'after', projection });
    if (!member) throw id.equals(actorId) ? restricted() : notFound();
    members.set(id.toHexString(), member);
  }
  return { actor: members.get(actorId.toHexString()), target: members.get(targetId.toHexString()) };
}
