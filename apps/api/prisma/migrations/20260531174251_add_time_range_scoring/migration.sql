-- CreateEnum
CREATE TYPE "SpotifyTimeRange" AS ENUM ('short_term', 'medium_term', 'long_term');

-- AlterTable
ALTER TABLE "UserFavoriteArtist"
ADD COLUMN "timeRange" "SpotifyTimeRange" NOT NULL DEFAULT 'medium_term';

-- AlterTable
ALTER TABLE "UserFavoriteTrack"
ADD COLUMN "timeRange" "SpotifyTimeRange" NOT NULL DEFAULT 'medium_term';

-- DropIndex
DROP INDEX "UserFavoriteArtist_userId_artistId_key";

-- DropIndex
DROP INDEX "UserFavoriteArtist_userId_rank_key";

-- DropIndex
DROP INDEX "UserFavoriteTrack_userId_trackId_key";

-- DropIndex
DROP INDEX "UserFavoriteTrack_userId_rank_key";

-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteArtist_userId_artistId_timeRange_key"
ON "UserFavoriteArtist"("userId", "artistId", "timeRange");

-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteArtist_userId_rank_timeRange_key"
ON "UserFavoriteArtist"("userId", "rank", "timeRange");

-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteTrack_userId_trackId_timeRange_key"
ON "UserFavoriteTrack"("userId", "trackId", "timeRange");

-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteTrack_userId_rank_timeRange_key"
ON "UserFavoriteTrack"("userId", "rank", "timeRange");
