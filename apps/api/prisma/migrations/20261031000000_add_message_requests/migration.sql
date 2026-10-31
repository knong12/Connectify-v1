CREATE TYPE "ConversationStatus" AS ENUM ('mutual', 'pending', 'accepted', 'declined');

ALTER TABLE "Conversation"
ADD COLUMN "status" "ConversationStatus" NOT NULL DEFAULT 'mutual',
ADD COLUMN "requesterId" TEXT;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_request_member"
CHECK (
  ("status" = 'mutual' AND "requesterId" IS NULL)
  OR ("status" <> 'mutual' AND "requesterId" IS NOT NULL
      AND "requesterId" IN ("memberAId", "memberBId"))
);
