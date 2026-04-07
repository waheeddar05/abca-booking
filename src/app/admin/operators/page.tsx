'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Users, Loader2, Search, Plus, Trash2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { useToast } from '@/components/ui/Toast';

interface OperatorAssignment {
  id: string;
  machineId: string;
  days: number[];
  createdAt: string;
}

interface DayPriority {
  morning: number;
  evening: number;
}

interface Operator {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
  operatorPriority: number;
  operatorMorningPriority: number;
  operatorEveningPriority: number;
  operatorDayPriorities: Record<string, DayPriority> | null;
  operatorAssignments: OperatorAssignment[];
}

const VALID_MACHINES = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AdminOperators() {
  const { data: session } = useSession();
  const toast = useToast();

  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Assignment modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);
  const [assignMachine, setAssignMachine] = useState('');
  const [assignDays, setAssignDays] = useState<number[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);

  // Edit days modal state
  const [editingAssignment, setEditingAssignment] = useState<{ operatorId: string; assignment: OperatorAssignment } | null>(null);
  const [editDays, setEditDays] = useState<number[]>([]);
  const [editLoading, setEditLoading] = useState(false);

  // Day-specific priority state
  const [expandedPriority, setExpandedPriority] = useState<string | null>(null);
  const [dayPriorities, setDayPriorities] = useState<Record<string, DayPriority>>({});
  const [savingPriority, setSavingPriority] = useState(false);

  // Confirm dialogs
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    variant?: 'default' | 'danger';
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  // Fetch operators
  useEffect(() => {
    fetchOperators();
  }, []);

  const fetchOperators = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/operators');
      if (res.ok) {
        const data = await res.json();
        setOperators(data.operators || []);
      } else {
        toast.error('Failed to fetch operators');
      }
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to fetch operators');
    } finally {
      setLoading(false);
    }
  };

  const filteredOperators = operators.filter(op => {
    const searchLower = search.toLowerCase();
    return (
      (op.name?.toLowerCase().includes(searchLower)) ||
      (op.email?.toLowerCase().includes(searchLower)) ||
      (op.mobileNumber?.includes(search))
    );
  });

  const openAssignModal = (operator: Operator) => {
    setSelectedOperator(operator);
    setAssignMachine('');
    setAssignDays([]);
    setShowAssignModal(true);
  };

  const handleAssign = async () => {
    if (!selectedOperator || !assignMachine) {
      toast.error('Please select a machine');
      return;
    }

    setAssignLoading(true);
    try {
      const res = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedOperator.id,
          machineId: assignMachine,
          days: assignDays,
        }),
      });

      if (res.ok) {
        toast.success(`${assignMachine} assigned successfully`);
        setShowAssignModal(false);
        setSelectedOperator(null);
        fetchOperators();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to assign machine');
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Failed to assign machine');
    } finally {
      setAssignLoading(false);
    }
  };

  const openEditDaysModal = (operatorId: string, assignment: OperatorAssignment) => {
    setEditingAssignment({ operatorId, assignment });
    setEditDays(assignment.days);
  };

  const handleEditDays = async () => {
    if (!editingAssignment) return;

    setEditLoading(true);
    try {
      const res = await fetch('/api/admin/operators', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingAssignment.operatorId,
          machineId: editingAssignment.assignment.machineId,
          days: editDays,
        }),
      });

      if (res.ok) {
        toast.success('Days updated successfully');
        setEditingAssignment(null);
        fetchOperators();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to update days');
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Failed to update days');
    } finally {
      setEditLoading(false);
    }
  };

  const confirmDelete = (operatorId: string, assignment: OperatorAssignment) => {
    setPendingConfirm({
      title: 'Remove Assignment',
      message: `Remove ${assignment.machineId} from this operator?`,
      variant: 'danger',
      confirmLabel: 'Remove',
      onConfirm: () => deleteAssignment(operatorId, assignment.machineId),
    });
  };

  const deleteAssignment = async (operatorId: string, machineId: string) => {
    try {
      const res = await fetch('/api/admin/operators', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: operatorId, machineId }),
      });

      if (res.ok) {
        toast.success('Assignment removed');
        fetchOperators();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to remove assignment');
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('Failed to remove assignment');
    }
  };

  const toggleDay = (dayIndex: number, isEditMode: boolean) => {
    if (isEditMode) {
      setEditDays(prev =>
        prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex].sort()
      );
    } else {
      setAssignDays(prev =>
        prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex].sort()
      );
    }
  };

  const getDaysDisplay = (days: number[]) => {
    if (days.length === 0) return 'All days';
    if (days.length === 7) return 'All days';
    return days.map(d => DAYS_OF_WEEK[d].slice(0, 3)).join(', ');
  };

  const openDayPriorities = (operator: Operator) => {
    if (expandedPriority === operator.id) {
      setExpandedPriority(null);
      return;
    }
    // Initialize from existing data
    const existing = (operator.operatorDayPriorities || {}) as Record<string, DayPriority>;
    const init: Record<string, DayPriority> = {};
    for (let d = 0; d < 7; d++) {
      init[String(d)] = existing[String(d)] || { morning: 0, evening: 0 };
    }
    setDayPriorities(init);
    setExpandedPriority(operator.id);
  };

  const saveDayPriorities = async (operator: Operator) => {
    setSavingPriority(true);
    try {
      const res = await fetch('/api/admin/operators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operators: [{
            userId: operator.id,
            priority: operator.operatorPriority,
            dayPriorities: dayPriorities,
          }],
        }),
      });
      if (res.ok) {
        toast.success('Day priorities updated');
        setExpandedPriority(null);
        fetchOperators();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to update');
      }
    } catch {
      toast.error('Failed to update');
    } finally {
      setSavingPriority(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        icon={Users}
        title="Operator Management"
        description="Manage operator assignments and weekday preferences"
        iconColor="text-purple-400"
        iconBg="bg-purple-500/10"
      />

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search operators by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
        </div>
      </div>

      {/* Operators List */}
      <div className="space-y-3">
        {filteredOperators.map(operator => (
          <div key={operator.id} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4 hover:border-white/[0.1] transition-colors">
            {/* Operator Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-white">{operator.name || 'Unnamed'}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  {operator.email} {operator.mobileNumber ? `· ${operator.mobileNumber}` : ''}
                </p>
              </div>
              <button
                onClick={() => openAssignModal(operator)}
                className="flex items-center gap-2 px-3 py-2 bg-accent/10 text-accent hover:bg-accent/20 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Assign
              </button>
            </div>

            {/* Priorities */}
            <div className="mb-4 pb-4 border-b border-white/[0.05]">
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="bg-white/[0.02] rounded-lg p-2">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Overall</p>
                  <p className="text-sm font-semibold text-white">{operator.operatorPriority || '-'}</p>
                </div>
                <div className="bg-white/[0.02] rounded-lg p-2">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Morning</p>
                  <p className="text-sm font-semibold text-blue-400">{operator.operatorMorningPriority || '-'}</p>
                </div>
                <div className="bg-white/[0.02] rounded-lg p-2">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Evening</p>
                  <p className="text-sm font-semibold text-orange-400">{operator.operatorEveningPriority || '-'}</p>
                </div>
              </div>
              <button
                onClick={() => openDayPriorities(operator)}
                className="text-[11px] text-accent hover:underline cursor-pointer"
              >
                {expandedPriority === operator.id ? 'Hide day-specific priorities' : 'Set day-specific priorities'}
              </button>
              {expandedPriority === operator.id && (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1.5 items-center">
                    <span className="text-[10px] text-slate-500"></span>
                    <span className="text-[10px] text-blue-400 text-center uppercase tracking-wider">Morning</span>
                    <span className="text-[10px] text-orange-400 text-center uppercase tracking-wider">Evening</span>
                    {DAYS_OF_WEEK.map((day, idx) => (
                      <>
                        <span key={`label-${idx}`} className="text-xs text-slate-300">{day.slice(0, 3)}</span>
                        <input
                          key={`m-${idx}`}
                          type="number"
                          min="0"
                          value={dayPriorities[String(idx)]?.morning || ''}
                          onChange={e => setDayPriorities(prev => ({
                            ...prev,
                            [String(idx)]: { ...prev[String(idx)], morning: parseInt(e.target.value) || 0 }
                          }))}
                          placeholder="0"
                          className="bg-white/[0.04] border border-white/[0.1] rounded px-2 py-1 text-xs text-white text-center outline-none focus:border-accent w-full"
                        />
                        <input
                          key={`e-${idx}`}
                          type="number"
                          min="0"
                          value={dayPriorities[String(idx)]?.evening || ''}
                          onChange={e => setDayPriorities(prev => ({
                            ...prev,
                            [String(idx)]: { ...prev[String(idx)], evening: parseInt(e.target.value) || 0 }
                          }))}
                          placeholder="0"
                          className="bg-white/[0.04] border border-white/[0.1] rounded px-2 py-1 text-xs text-white text-center outline-none focus:border-accent w-full"
                        />
                      </>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500">0 = use default morning/evening priority</p>
                  <button
                    onClick={() => saveDayPriorities(operator)}
                    disabled={savingPriority}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-light text-primary text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savingPriority && <Loader2 className="w-3 h-3 animate-spin" />}
                    Save Day Priorities
                  </button>
                </div>
              )}
            </div>

            {/* Assignments */}
            {operator.operatorAssignments.length > 0 ? (
              <div className="space-y-2">
                {operator.operatorAssignments.map(assignment => (
                  <div
                    key={assignment.id}
                    className="flex items-center justify-between bg-white/[0.02] rounded-lg p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{assignment.machineId}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{getDaysDisplay(assignment.days)}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <button
                        onClick={() => openEditDaysModal(operator.id, assignment)}
                        className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors"
                        title="Edit days"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => confirmDelete(operator.id, assignment)}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Remove assignment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No machines assigned</p>
            )}
          </div>
        ))}
      </div>

      {filteredOperators.length === 0 && (
        <div className="text-center py-12">
          <AlertTriangle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No operators found</p>
        </div>
      )}

      {/* Assign Modal */}
      {showAssignModal && selectedOperator && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1d35] border border-white/[0.1] rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                Assign Machine to {selectedOperator.name || 'Operator'}
              </h2>
              <button
                onClick={() => setShowAssignModal(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Machine Select */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">Machine</label>
                <select
                  value={assignMachine}
                  onChange={(e) => setAssignMachine(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                >
                  <option value="">Select machine...</option>
                  {VALID_MACHINES.map(machine => (
                    <option key={machine} value={machine}>
                      {machine}
                    </option>
                  ))}
                </select>
              </div>

              {/* Days Selection */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">
                  Available Days (leave empty for all days)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {DAYS_OF_WEEK.map((day, index) => (
                    <button
                      key={index}
                      onClick={() => toggleDay(index, false)}
                      className={`p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        assignDays.includes(index)
                          ? 'bg-accent text-white'
                          : 'bg-white/[0.04] border border-white/[0.1] text-slate-300 hover:bg-white/[0.08]'
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
                {assignDays.length > 0 && (
                  <p className="text-xs text-slate-400 mt-2">
                    Selected: {assignDays.map(d => DAYS_OF_WEEK[d].slice(0, 3)).join(', ')}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowAssignModal(false)}
                className="flex-1 px-4 py-2 bg-white/[0.06] text-slate-300 hover:bg-white/[0.08] rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={assignLoading || !assignMachine}
                className="flex-1 px-4 py-2 bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {assignLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Days Modal */}
      {editingAssignment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1d35] border border-white/[0.1] rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                Edit Days for {editingAssignment.assignment.machineId}
              </h2>
              <button
                onClick={() => setEditingAssignment(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2">
                Available Days (leave empty for all days)
              </label>
              <div className="grid grid-cols-4 gap-2">
                {DAYS_OF_WEEK.map((day, index) => (
                  <button
                    key={index}
                    onClick={() => toggleDay(index, true)}
                    className={`p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      editDays.includes(index)
                        ? 'bg-accent text-white'
                        : 'bg-white/[0.04] border border-white/[0.1] text-slate-300 hover:bg-white/[0.08]'
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
              {editDays.length > 0 && (
                <p className="text-xs text-slate-400 mt-2">
                  Selected: {editDays.map(d => DAYS_OF_WEEK[d].slice(0, 3)).join(', ')}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setEditingAssignment(null)}
                className="flex-1 px-4 py-2 bg-white/[0.06] text-slate-300 hover:bg-white/[0.08] rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleEditDays}
                disabled={editLoading}
                className="flex-1 px-4 py-2 bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {editLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!pendingConfirm}
        title={pendingConfirm?.title || ''}
        message={pendingConfirm?.message || ''}
        variant={pendingConfirm?.variant}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        onConfirm={() => {
          pendingConfirm?.onConfirm();
          setPendingConfirm(null);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
