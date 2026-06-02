-- Add TENNIS to the PackageBallType enum. Tennis-ball machines
-- (e.g. Master 200, iWinner, Leverage) expose a Machine / Tennis ball-type
-- axis on packages, mirroring the Machine / Leather axis of leather machines.
ALTER TYPE "PackageBallType" ADD VALUE IF NOT EXISTS 'TENNIS';
