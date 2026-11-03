export function createNotificationWriter(db) {
  const notifications = db.collection('notifications');

  return async function notify({ type, actorId, recipientId, postId, commentId, relationshipId, createdAt }, session) {
    if (actorId.equals(recipientId)) return;
    const event = { type, actorId, recipientId };
    if (postId) event.postId = postId;
    if (commentId) event.commentId = commentId;
    const activity = { createdAt, readAt: null };
    if (relationshipId) activity.relationshipId = relationshipId;
    await notifications.updateOne(event, { $set: activity }, { session, upsert: true });
  };
}
