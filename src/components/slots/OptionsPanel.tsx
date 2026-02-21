'use client';

import { Check, AlertTriangle } from 'lucide-react';
import { BALL_TYPES, PITCH_TYPE_LABELS } from '@/lib/client-constants';
import type { MachineConfig, OperationMode } from '@/lib/schemas';

interface OptionsPanelProps {
  isLeatherMachine: boolean;
  machineConfig: MachineConfig | null;
  ballType: string;
  pitchType: string;
  operationMode: OperationMode;
  enabledPitchTypes: string[];
  showPitchSelection: boolean;
  showPitchIndicator: boolean;
  onBallTypeChange: (value: string) => void;
  onPitchTypeChange: (value: string) => void;
  onOperationModeChange: (mode: OperationMode) => void;
}

export function OptionsPanel({
  isLeatherMachine,
  machineConfig,
  ballType,
  pitchType,
  operationMode,
  enabledPitchTypes,
  showPitchSelection,
  showPitchIndicator,
  onBallTypeChange,
  onPitchTypeChange,
  onOperationModeChange,
}: OptionsPanelProps) {
  return (
    <div className="mb-4 space-y-2.5">
      {/* Ball Type */}
      {isLeatherMachine && machineConfig?.leatherMachine.ballTypeSelectionEnabled && (
        <div>
          <label className="block text-xs font-bold text-white mb-1 uppercase tracking-wider">
            Ball Type
          </label>
          <div className="flex gap-2">
            {BALL_TYPES.filter(t => t.value !== 'TENNIS').map((type) => (
              <ToggleButton
                key={type.value}
                isActive={ballType === type.value}
                onClick={() => onBallTypeChange(type.value)}
                label={type.label}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pitch Type (multiple options) */}
      {showPitchSelection && (
        <div>
          <label className="block text-xs font-bold text-white mb-1 uppercase tracking-wider">
            Pitch Type
          </label>
          <div className="flex gap-2">
            {enabledPitchTypes.map((pt) => {
              const info = PITCH_TYPE_LABELS[pt] || { label: pt, color: 'bg-slate-500' };
              return (
                <ToggleButton
                  key={pt}
                  isActive={pitchType === pt}
                  onClick={() => onPitchTypeChange(pt)}
                  label={info.label}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Pitch Type (single, auto-selected) */}
      {showPitchIndicator && (
        <div>
          <label className="block text-xs font-bold text-white mb-1 uppercase tracking-wider">
            Pitch Type
          </label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-accent/15 text-accent border border-accent/20">
              <Check className="w-3.5 h-3.5" />
              {(PITCH_TYPE_LABELS[enabledPitchTypes[0]] || { label: enabledPitchTypes[0] }).label}
              <span className="text-[10px] text-slate-500 font-normal ml-1">(Auto-selected)</span>
            </div>
          </div>
        </div>
      )}

      {/* Operation Mode */}
      {!isLeatherMachine && (
        <div>
          <label className="block text-xs font-bold text-white mb-1 uppercase tracking-wider">
            Operation Mode
          </label>
          <div className="flex gap-2">
            <ToggleButton
              isActive={operationMode === 'WITH_OPERATOR'}
              onClick={() => onOperationModeChange('WITH_OPERATOR')}
              label="With Operator"
            />
            <ToggleButton
              isActive={operationMode === 'SELF_OPERATE'}
              onClick={() => onOperationModeChange('SELF_OPERATE')}
              label="Self Operate"
            />
          </div>
        </div>
      )}

      {/* Self Operate Warning */}
      {operationMode === 'SELF_OPERATE' && !isLeatherMachine && (
        <div className="px-3 py-3 bg-red-500/15 border-2 border-red-500/40 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-red-400">Self Operate Mode</p>
            <p className="text-xs text-red-300 mt-0.5">
              No machine operator will be provided. You must operate the bowling machine yourself.
              Please ensure you are familiar with machine operation before booking.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared Toggle Button (no dots, yellow/accent selection) ─────
function ToggleButton({
  isActive,
  onClick,
  label,
}: {
  isActive: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
        isActive
          ? 'bg-accent text-primary shadow-sm'
          : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
      }`}
    >
      {label}
    </button>
  );
}
