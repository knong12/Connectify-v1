DO $$
BEGIN
  -- Accepted mutual chats have no requester; pending/declined requests still must.
  ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_request_member";
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_request_member"
  CHECK (
    ("status" IN ('mutual', 'accepted') AND "requesterId" IS NULL)
    OR ("status" <> 'mutual' AND "requesterId" IS NOT NULL
        AND "requesterId" IN ("memberAId", "memberBId"))
  );

  -- Preserve permission for existing mutual chats, including previously paused chats.
  UPDATE "Conversation" AS conversation
  SET "status" = 'accepted'
  WHERE conversation."status" = 'mutual'
    AND EXISTS (
      SELECT 1 FROM "Message" AS message
      WHERE message."conversationId" = conversation."id"
    );
END $$;
