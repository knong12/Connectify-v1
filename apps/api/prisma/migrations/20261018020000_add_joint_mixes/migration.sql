ALTER TABLE "User" ADD COLUMN "spotifyScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "MixSave" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "trackIds" TEXT[] NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "spotifyPlaylistId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MixSave_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MixSave_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MixSave_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MixSave_distinct_users" CHECK ("ownerId" <> "targetUserId")
);
CREATE INDEX "MixSave_ownerId_createdAt_idx" ON "MixSave"("ownerId", "createdAt");
