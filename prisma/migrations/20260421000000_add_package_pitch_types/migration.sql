-- AlterTable: add multi-pitch support to Package
ALTER TABLE "Package" ADD COLUMN "pitchTypes" "PitchType"[] DEFAULT ARRAY[]::"PitchType"[];
