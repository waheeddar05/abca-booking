'use client';

import { useMemo } from 'react';
import type { AvailableSlot, MachineConfig, MachineId } from '@/lib/schemas';
import type { PricingConfig } from '@/lib/pricing';

interface UsePricingParams {
  selectedSlots: AvailableSlot[];
  machineConfig: MachineConfig | null;
  selectedMachineId: MachineId;
  isLeatherMachine: boolean;
  ballType: string;
  pitchType: string;
}

interface UsePricingReturn {
  isConsecutive: boolean;
  consecutiveTotal: number | null;
  originalTotal: number;
  totalPrice: number;
  hasSavings: boolean;
  savings: number;
  recurringDiscount: number;
  getSlotDisplayPrice: (slot: AvailableSlot) => number;
}

function checkConsecutive(slots: AvailableSlot[]): boolean {
  if (slots.length < 2) return false;
  const sorted = [...slots].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  for (let i = 0; i < sorted.length - 1; i++) {
    if (new Date(sorted[i].endTime).getTime() !== new Date(sorted[i + 1].startTime).getTime()) {
      return false;
    }
  }
  return true;
}

function calcConsecutiveTotal(
  slots: AvailableSlot[],
  pc: PricingConfig,
  isLeatherMachine: boolean,
  selectedMachineId: MachineId,
  ballType: string,
  pitchType: string
): number | null {
  if (!checkConsecutive(slots)) return null;

  const sorted = [...slots].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  let total = 0;
  for (const slot of sorted) {
    const slab = (slot.timeSlab || 'morning') as 'morning' | 'evening';
    const pType = pitchType === 'TURF' ? 'CEMENT' : (pitchType || 'ASTRO');
    const validPType = (['ASTRO', 'CEMENT', 'NATURAL'].includes(pType) ? pType : 'ASTRO') as 'ASTRO' | 'CEMENT' | 'NATURAL';

    let consecutiveFor2: number;
    if (isLeatherMachine) {
      const subType = selectedMachineId === 'YANTRA' ? 'yantra' : (ballType === 'LEATHER' ? 'leather' : 'machine');
      consecutiveFor2 = pc[subType as keyof PricingConfig][validPType][slab].consecutive;
    } else {
      consecutiveFor2 = pc.tennis[validPType][slab].consecutive;
    }
    total += consecutiveFor2 / 2;
  }

  return total;
}

export function usePricing({
  selectedSlots,
  machineConfig,
  selectedMachineId,
  isLeatherMachine,
  ballType,
  pitchType,
}: UsePricingParams): UsePricingReturn {
  const getSlotDisplayPrice = (slot: AvailableSlot): number => {
    return slot.price ?? machineConfig?.defaultSlotPrice ?? 600;
  };

  return useMemo(() => {
    const isConsecutive = checkConsecutive(selectedSlots);

    const consecutiveTotal =
      machineConfig?.pricingConfig
        ? calcConsecutiveTotal(
            selectedSlots,
            machineConfig.pricingConfig,
            isLeatherMachine,
            selectedMachineId,
            ballType,
            pitchType
          )
        : null;

    const originalTotal = selectedSlots.reduce(
      (sum, slot) => sum + (slot.price ?? machineConfig?.defaultSlotPrice ?? 600),
      0
    );

    // Calculate recurring slot discount — apply per qualifying slot
    let recurringDiscount = 0;
    if (selectedSlots.length > 0) {
      const qualifyingSlots = selectedSlots.filter(s => s.recurringDiscount);
      if (qualifyingSlots.length > 0) {
        const perSlot = isConsecutive && selectedSlots.length >= 2
          ? qualifyingSlots[0].recurringDiscount!.twoSlotDiscount
          : qualifyingSlots[0].recurringDiscount!.oneSlotDiscount;
        recurringDiscount = perSlot * qualifyingSlots.length;
      }
    }

    const priceAfterConsecutive = consecutiveTotal ?? originalTotal;
    const totalPrice = Math.max(0, priceAfterConsecutive - recurringDiscount);
    const hasSavings = totalPrice < originalTotal;
    const savings = hasSavings ? originalTotal - totalPrice : 0;

    return {
      isConsecutive,
      consecutiveTotal,
      originalTotal,
      totalPrice,
      hasSavings,
      savings,
      recurringDiscount,
      getSlotDisplayPrice,
    };
  }, [selectedSlots, machineConfig, selectedMachineId, isLeatherMachine, ballType, pitchType]);
}
