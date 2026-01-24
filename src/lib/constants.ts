import { BallType } from '@prisma/client';

export const MACHINE_A_BALLS: BallType[] = ['LEATHER', 'MACHINE'];
export const MACHINE_B_BALLS: BallType[] = ['TENNIS'];

export function getRelevantBallTypes(ballType: BallType): BallType[] {
  if (MACHINE_A_BALLS.includes(ballType)) {
    return MACHINE_A_BALLS;
  }
  if (MACHINE_B_BALLS.includes(ballType)) {
    return MACHINE_B_BALLS;
  }
  return [];
}

export function isValidBallType(ballType: string): ballType is BallType {
  return [...MACHINE_A_BALLS, ...MACHINE_B_BALLS].includes(ballType as BallType);
}
