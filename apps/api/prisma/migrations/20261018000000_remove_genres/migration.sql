-- Remove only retired genre data; user and artist/track relationships are preserved.
DROP TABLE "UserFavoriteGenre";
DROP TABLE "Genre";
ALTER TABLE "Artist" DROP COLUMN "genres";
