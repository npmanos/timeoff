import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Settings, 
  Trash2, 
  Edit2, 
  AlertCircle, 
  Download,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  Upload,
  Save
} from 'lucide-react';

// --- Constants & Config ---

const INITIAL_START_DATE = '2025-10-22';

// Default configuration based on user prompt
const DEFAULT_CONFIG = {
  pto: {
    label: 'PTO',
    yearlyAllowance: 120,
    monthlyRate: 10,
    startAdvance: 16,
    cap: 160,
    increment: 4,
    minBalance: -32,
    paybackMonths: 12,
    reset: false
  },
  sick: {
    label: 'Sick Time',
    yearlyAllowance: 80,
    monthlyRate: 6.6667,
    startAdvance: 16,
    cap: 160,
    increment: 1,
    minBalance: 0,
    paybackMonths: 12,
    reset: false
  },
  personal: {
    label: 'Personal',
    yearlyAllowance: 16,
    increment: 1,
    minBalance: 0,
    reset: true,
    resetDate: '01-01',
    expireDate: '12-31'
  }
};

// --- Helper Functions ---

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00'); // Fix timezone offset issues
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const getMonthKey = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const formatNumber = (num) => {
  return parseFloat(num).toFixed(2).replace(/[.,]00$/, "");
};

// --- Main Component ---

export default function App() {
  // --- State ---
   
  const [currentDate, setCurrentDate] = useState(new Date()); // For Dashboard View
  const [transactions, setTransactions] = useState([]);
  const [selectedType, setSelectedType] = useState(null); // Filter
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingTx, setEditingTx] = useState(null);

  // Settings State (Persisted)
  const [userSettings, setUserSettings] = useState(() => {
    const saved = localStorage.getItem('timeoff_settings');
    const parsed = saved ? JSON.parse(saved) : {};
    
    // Ensure structure exists (migration safe)
    return {
      startDate: parsed.startDate || INITIAL_START_DATE,
      rateAdjustments: parsed.rateAdjustments || [] 
    };
  });

  // Load transactions from local storage on mount
  useEffect(() => {
    const savedTx = localStorage.getItem('timeoff_transactions');
    if (savedTx) {
      setTransactions(JSON.parse(savedTx));
    }
  }, []);

  // Save to local storage whenever data changes
  useEffect(() => {
    localStorage.setItem('timeoff_transactions', JSON.stringify(transactions));
    localStorage.setItem('timeoff_settings', JSON.stringify(userSettings));
  }, [transactions, userSettings]);

  // --- Engine: Balance Calculation & System Transaction Generation ---

  const processedData = useMemo(() => {
    const startDate = new Date(userSettings.startDate + 'T00:00:00');
    // We calculate dates up to 1 year in future of view to ensure we catch everything relevant
    const calcLimitDate = new Date(currentDate);
    calcLimitDate.setFullYear(calcLimitDate.getFullYear() + 1);

    let generatedTransactions = [];
    
    // Helper: Determine rate for a specific date (handling overrides)
    const getRateForDate = (type, dateObj, monthIndex) => {
        // 1. Check for Manual Overrides (Adjustments)
        // Sort adjustments by date descending to find the latest applicable one
        const activeAdjustment = userSettings.rateAdjustments
            .filter(adj => adj.type === type && new Date(adj.effectiveDate + 'T00:00:00') <= dateObj)
            .sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))[0];

        if (activeAdjustment) {
            return parseFloat(activeAdjustment.rate);
        }

        // 2. Default Logic (including Payback period)
        const config = DEFAULT_CONFIG[type];
        
        // If type doesn't support monthly accrual (like Personal), return 0 here
        if (!config.monthlyRate) return 0;

        // Payback Logic
        if (config.paybackMonths && monthIndex <= config.paybackMonths) {
            return (config.yearlyAllowance - config.startAdvance) / 12;
        }
        
        return config.yearlyAllowance / 12;
    };

    // 1. Initial Advances (Day 0)
    generatedTransactions.push({
      id: 'sys_init_pto',
      date: userSettings.startDate,
      type: 'pto',
      amount: DEFAULT_CONFIG.pto.startAdvance,
      note: 'Initial Advance',
      isSystem: true
    });
    generatedTransactions.push({
      id: 'sys_init_sick',
      date: userSettings.startDate,
      type: 'sick',
      amount: DEFAULT_CONFIG.sick.startAdvance,
      note: 'Initial Advance',
      isSystem: true
    });

    // 2. Personal Time First Grant
    // Logic: Start + 2 months (approx 1st of month following first full month)
    // Note: We use string manipulation to avoid timezone shifts on grants
    const userSpecificPersonalGrant = '2025-12-01';
    generatedTransactions.push({
      id: 'sys_init_personal',
      date: userSpecificPersonalGrant,
      type: 'personal',
      amount: 2, 
      note: 'New Hire Prorated Grant',
      isSystem: true
    });

    // 3. Generate Monthly Accruals
    // Start iterating from first accrual date (approx 2 months after start for PTO/Sick)
    let iterDate = new Date(startDate);
    iterDate.setDate(1);
    iterDate.setMonth(iterDate.getMonth() + 2);

    while (iterDate <= calcLimitDate) {
      // Fix: Use local date components to construct string, preventing UTC shift (e.g. 2026-01-01 becoming 2025-12-31)
      const year = iterDate.getFullYear();
      const month = String(iterDate.getMonth() + 1).padStart(2, '0');
      const day = String(iterDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const monthIndex = (iterDate.getFullYear() - startDate.getFullYear()) * 12 + (iterDate.getMonth() - startDate.getMonth());
      
      // -- PTO Accrual --
      const ptoRate = getRateForDate('pto', iterDate, monthIndex);
      if (ptoRate > 0) {
          generatedTransactions.push({
            id: `sys_pto_${dateStr}`,
            date: dateStr,
            type: 'pto',
            amount: ptoRate,
            note: 'Monthly Accrual',
            isSystem: true,
            checkCap: true
          });
      }

      // -- Sick Accrual --
      const sickRate = getRateForDate('sick', iterDate, monthIndex);
      if (sickRate > 0) {
          generatedTransactions.push({
            id: `sys_sick_${dateStr}`,
            date: dateStr,
            type: 'sick',
            amount: sickRate,
            note: 'Monthly Accrual',
            isSystem: true,
            checkCap: true
          });
      }

      // -- Personal Time Yearly Reset/Grant --
      // If Jan 1st
      if (iterDate.getMonth() === 0) {
        // Check for Personal Rate overrides?
        // Personal is yearly, so we check just the default or a "Yearly Allowance" override?
        // For now, using standard logic + simple override if we added "personal" to adjustments
        // We will assume adjustments for Personal mean "New Yearly Grant Amount"
        
        let personalAmount = DEFAULT_CONFIG.personal.yearlyAllowance;
        const personalAdj = userSettings.rateAdjustments
            .filter(adj => adj.type === 'personal' && new Date(adj.effectiveDate + 'T00:00:00') <= iterDate)
            .sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))[0];
        
        if (personalAdj) personalAmount = parseFloat(personalAdj.rate);

        generatedTransactions.push({
            id: `sys_personal_grant_${dateStr}`,
            date: dateStr,
            type: 'personal',
            amount: personalAmount,
            note: 'Annual Grant',
            isSystem: true
        });
      }

      // Next month
      iterDate.setMonth(iterDate.getMonth() + 1);
    }

    // 4. Merge Manual & System
    let allTx = [...transactions, ...generatedTransactions];

    // 5. Sort by Date
    allTx.sort((a, b) => {
      if (a.date === b.date) {
        // System transactions first (accruals) -> then Expiry (inserted later) -> then Manual
        // We want Grants (System) to happen, then Expiry triggers if new year? 
        // No, Expiry triggers on the FIRST transaction of the new year.
        if (a.isSystem && !b.isSystem) return -1;
        if (!a.isSystem && b.isSystem) return 1;
        return 0;
      }
      return new Date(a.date) - new Date(b.date);
    });

    // 6. Calculate Running Balance & Apply Caps/Resets
    const history = [];
    const running = { pto: 0, sick: 0, personal: 0 };
    let lastYear = startDate.getFullYear();

    for (let i = 0; i < allTx.length; i++) {
        const tx = allTx[i];
        
        // Fix: Parse year strictly from string to avoid timezone shift causing 2026-01-01 to be read as 2025
        const txYear = parseInt(tx.date.split('-')[0]);

        // Check for Personal Reset (Dec 31 of previous year)
        // Triggered when we encounter the first transaction of a NEW year
        if (txYear > lastYear) {
            if (running.personal > 0) {
                // CHANGED: Expiry now happens on Jan 1st of the NEW year, not Dec 31 of old year.
                // This prevents December balances from appearing as 0.
                const expiryDate = `${txYear}-01-01`;
                history.push({
                    id: `sys_expire_${lastYear}`,
                    date: expiryDate,
                    type: 'personal',
                    amount: -running.personal,
                    note: 'Previous Year Expiry',
                    isSystem: true,
                    balanceAfter: 0
                });
                running.personal = 0; 
            }
            lastYear = txYear;
        }

        let amount = parseFloat(tx.amount);
        
        // CAP LOGIC
        if (tx.checkCap) {
            const cap = DEFAULT_CONFIG[tx.type].cap;
            if (running[tx.type] >= cap) {
                amount = 0; 
            }
        }

        running[tx.type] += amount;
        
        history.push({
            ...tx,
            amount: amount,
            balanceAfter: running[tx.type]
        });
    }

    return { history, balances: running };
  }, [transactions, userSettings, currentDate]);

  // --- Derived State for View ---

  const currentMonthKey = getMonthKey(currentDate);
  
  const monthlyStats = useMemo(() => {
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    
    const stats = {
        pto: { earned: 0, used: 0, balance: 0 },
        sick: { earned: 0, used: 0, balance: 0 },
        personal: { earned: 0, used: 0, balance: 0 }
    };

    let latestBalances = { pto: 0, sick: 0, personal: 0 };

    processedData.history.forEach(tx => {
        const txDate = new Date(tx.date + 'T00:00:00');
        
        if (txDate <= endOfMonth) {
            latestBalances[tx.type] = tx.balanceAfter;
        }

        if (txDate >= startOfMonth && txDate <= endOfMonth) {
            if (tx.amount > 0) stats[tx.type].earned += tx.amount;
            if (tx.amount < 0) stats[tx.type].used += Math.abs(tx.amount);
        }
    });

    stats.pto.balance = latestBalances.pto;
    stats.sick.balance = latestBalances.sick;
    stats.personal.balance = latestBalances.personal;

    return stats;
  }, [processedData, currentDate]);

  // Filter transactions for the current month view
  const currentMonthTransactions = useMemo(() => {
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    return processedData.history
      .filter(tx => {
        const txDate = new Date(tx.date + 'T00:00:00');
        return (
          txDate >= startOfMonth && 
          txDate <= endOfMonth && 
          (!selectedType || tx.type === selectedType)
        );
      })
      .slice()
      .reverse();
  }, [processedData.history, currentDate, selectedType]);


  // --- Handlers ---

  const handleMonthChange = (direction) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const handleExport = () => {
    const monthStr = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    const relevantTx = processedData.history.filter(tx => {
        const d = new Date(tx.date + 'T00:00:00');
        return d >= startOfMonth && d <= endOfMonth;
    });

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Date,Type,Category,Note,Amount,Balance After\n";

    relevantTx.forEach(tx => {
        const category = tx.amount >= 0 ? "Earned" : "Used";
        const row = [
            tx.date,
            DEFAULT_CONFIG[tx.type].label,
            category,
            `"${tx.note}"`,
            Math.abs(tx.amount).toFixed(2),
            tx.balanceAfter.toFixed(2)
        ].join(",");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `TimeOff_Report_${getMonthKey(currentDate)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const deleteTransaction = (id) => {
    if (window.confirm("Are you sure you want to delete this transaction? This cannot be undone.")) {
        setTransactions(prev => prev.filter(t => t.id !== id));
        if (isFormOpen) closeModal();
    }
  };

  const openForm = (tx = null) => {
    setEditingTx(tx);
    setIsFormOpen(true);
  };

  const closeModal = () => {
    setIsFormOpen(false);
    setEditingTx(null);
  };

  const saveTransaction = (data) => {
    if (editingTx) {
        setTransactions(prev => prev.map(t => t.id === editingTx.id ? { ...data, id: editingTx.id } : t));
    } else {
        setTransactions(prev => [...prev, { ...data, id: crypto.randomUUID(), isSystem: false }]);
    }
    closeModal();
  };

  const handleUpdateSettings = (newSettings) => {
     setUserSettings(prev => ({...prev, ...newSettings}));
     setIsSettingsOpen(false);
  };

  const handleFullRestore = (data) => {
      if (data.settings && data.transactions) {
          if (window.confirm("This will overwrite your current data with the backup. Are you sure?")) {
              setUserSettings(data.settings);
              setTransactions(data.transactions);
              setIsSettingsOpen(false);
          }
      } else {
          // Simple error handling for invalid format
          console.error("Invalid backup file format");
      }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Time Off Tracker</h1>
            <div className="flex gap-2">
                <button 
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition"
                    title="Settings & Backup"
                >
                    <Settings size={20} />
                </button>
            </div>
        </div>

        {/* Dashboard Controls */}
        <div className="flex items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-gray-100 w-fit">
            <button onClick={() => handleMonthChange(-1)} className="p-1 hover:bg-gray-100 rounded">
                <ChevronLeft size={20} />
            </button>
            <span className="font-semibold w-32 text-center select-none">
                {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => handleMonthChange(1)} className="p-1 hover:bg-gray-100 rounded">
                <ChevronRight size={20} />
            </button>
            <div className="w-px h-6 bg-gray-200 mx-1"></div>
            <button onClick={handleExport} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Export Month to CSV">
                <Download size={18} />
            </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['pto', 'sick', 'personal'].map(type => {
                const config = DEFAULT_CONFIG[type];
                const stats = monthlyStats[type];
                const isSelected = selectedType === type;
                const isDimmed = selectedType && !isSelected;

                return (
                    <div 
                        key={type}
                        onClick={() => setSelectedType(isSelected ? null : type)}
                        className={`
                            relative bg-white rounded-xl p-6 border transition-all duration-300 cursor-pointer overflow-hidden
                            ${isSelected ? 'border-blue-500 shadow-lg scale-105 z-10' : 'border-gray-200 shadow-sm hover:border-blue-300'}
                            ${isDimmed ? 'opacity-50 grayscale-[0.5]' : 'opacity-100'}
                        `}
                    >
                        <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wide">{config.label}</h3>
                        <div className="mt-2 flex justify-center py-4">
                            <span className="text-4xl font-bold text-gray-900">{formatNumber(stats.balance)}</span>
                            <span className="text-sm text-gray-400 self-end mb-1 ml-1">hrs</span>
                        </div>
                        <div className="flex justify-between text-xs font-medium border-t pt-3 mt-1">
                            <div className="text-emerald-600">
                                Earned: +{formatNumber(stats.earned)}
                            </div>
                            <div className="text-rose-600">
                                Used: -{formatNumber(stats.used)}
                            </div>
                        </div>
                        {isSelected && (
                             <div className="absolute top-2 right-2 text-blue-500">
                                <Filter size={16} />
                             </div>
                        )}
                    </div>
                )
            })}
        </div>

        {/* Transaction Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="font-semibold text-gray-700">Transactions</h3>
                {selectedType && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full font-medium">
                        Filtered: {DEFAULT_CONFIG[selectedType].label}
                    </span>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-500 font-medium border-b">
                        <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Type</th>
                            <th className="px-6 py-3">Amount</th>
                            <th className="px-6 py-3">Note</th>
                            <th className="px-6 py-3 text-right">Balance</th>
                            <th className="px-6 py-3 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {currentMonthTransactions.map((tx) => (
                            <tr 
                                key={tx.id} 
                                className={`
                                    hover:bg-gray-50 transition-colors
                                    ${tx.isSystem && tx.amount > 0 ? 'bg-emerald-50/30' : ''}
                                `}
                            >
                                <td className="px-6 py-3 whitespace-nowrap text-gray-600 font-medium">
                                    {formatDate(tx.date)}
                                </td>
                                <td className="px-6 py-3">
                                    <span className={`
                                        px-2 py-1 rounded text-xs font-semibold
                                        ${tx.type === 'pto' ? 'bg-indigo-100 text-indigo-700' : 
                                          tx.type === 'sick' ? 'bg-purple-100 text-purple-700' : 
                                          'bg-orange-100 text-orange-700'}
                                    `}>
                                        {DEFAULT_CONFIG[tx.type].label}
                                    </span>
                                </td>
                                <td className={`px-6 py-3 font-semibold ${tx.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {tx.amount > 0 ? '+' : ''}{formatNumber(tx.amount)}
                                </td>
                                <td className="px-6 py-3 text-gray-500 max-w-xs truncate" title={tx.note}>
                                    {tx.note}
                                </td>
                                <td className="px-6 py-3 text-right font-mono text-gray-700">
                                    {formatNumber(tx.balanceAfter)}
                                </td>
                                <td className="px-6 py-3 text-center">
                                    {!tx.isSystem && (
                                        <div className="flex justify-center gap-2">
                                            <button 
                                                onClick={() => openForm(tx)}
                                                className="p-1 text-gray-400 hover:text-blue-600 transition"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button 
                                                onClick={() => deleteTransaction(tx.id)}
                                                className="p-1 text-gray-400 hover:text-rose-600 transition"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {currentMonthTransactions.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-gray-400 italic">
                                    No transactions found for this month.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>

      </div>

      {/* Floating Action Button */}
      <button 
        onClick={() => openForm()}
        className="fixed bottom-8 right-8 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 transition-transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-300"
      >
        <Plus size={24} />
      </button>

      {/* Modals */}
      {isFormOpen && (
        <InputForm 
            onClose={closeModal} 
            onSave={saveTransaction} 
            onDelete={deleteTransaction}
            initialData={editingTx}
            processedHistory={processedData.history}
            config={DEFAULT_CONFIG}
        />
      )}

      {isSettingsOpen && (
        <SettingsForm 
            onClose={() => setIsSettingsOpen(false)}
            onSave={handleUpdateSettings}
            currentSettings={userSettings}
            transactions={transactions}
            onRestore={handleFullRestore}
        />
      )}
    </div>
  );
}

// --- Sub-Components ---

function InputForm({ onClose, onSave, onDelete, initialData, processedHistory, config }) {
    const [formData, setFormData] = useState({
        date: new Date().toISOString().split('T')[0],
        type: 'pto',
        action: 'use', // 'use' or 'add'
        amount: '', // Changed to empty string to avoid NaN issues
        note: ''
    });
    const [error, setError] = useState(null);

    // If editing, load data
    useEffect(() => {
        if (initialData) {
            setFormData({
                date: initialData.date,
                type: initialData.type,
                action: initialData.amount < 0 ? 'use' : 'add',
                amount: Math.abs(initialData.amount).toString(), // Convert to string for input compatibility
                note: initialData.note
            });
        }
    }, [initialData]);

    const currentTypeConfig = config[formData.type];

    // Calculate projected balance for validation
    // We need the balance *on the selected date* before this transaction
    const getProjectedBalance = () => {
        // Find the last transaction ON or BEFORE this date that isn't the one we are editing
        // Since history is sorted, we can search backwards or filter
        const relevant = processedHistory.filter(t => 
             // Date is before or same
            (new Date(t.date) <= new Date(formData.date)) && 
            t.type === formData.type &&
            (!initialData || t.id !== initialData.id) // Exclude self if editing
        );
        
        if (relevant.length === 0) return 0;
        // The sorted history logic handles cumulative balance, so taking the last one is safe
        const sorted = relevant.sort((a,b) => new Date(a.date) - new Date(b.date));
        return sorted.length > 0 ? sorted[sorted.length - 1].balanceAfter : 0;
    };

    const validate = () => {
        setError(null);
        const amt = parseFloat(formData.amount);
        if (isNaN(amt) || amt <= 0) return "Amount must be greater than 0.";
        
        // Increment check
        const increment = currentTypeConfig.increment;
        if ((amt % increment) !== 0) {
            return `${currentTypeConfig.label} must be used in ${increment} hour increments.`;
        }

        if (formData.action === 'use') {
            const currentBal = getProjectedBalance();
            const minBal = currentTypeConfig.minBalance;
            const newBal = currentBal - amt;
            
            if (newBal < minBal) {
                return `Insufficient funds. Minimum balance is ${minBal} hrs. Current available: ${formatNumber(currentBal)} hrs.`;
            }
        }
        return null;
    };

    // Store raw string in state to allow empty string and decimals while typing
    const handleAmountChange = (val) => {
        setFormData(prev => ({ ...prev, amount: val }));
    };

    const handleSave = () => {
        const err = validate();
        if (err) {
            setError(err);
            return;
        }

        const amt = parseFloat(formData.amount);
        const finalAmount = formData.action === 'use' ? -Math.abs(amt) : Math.abs(amt);
        onSave({
            date: formData.date,
            type: formData.type,
            amount: finalAmount,
            note: formData.note || (formData.action === 'add' ? 'Manual Adjustment' : 'Time Off')
        });
    };

    // Header info
    const currentBalance = getProjectedBalance();
    // Safety check to prevent NaN in display while typing
    const displayAmount = (formData.amount === '' || isNaN(parseFloat(formData.amount))) ? 0 : parseFloat(formData.amount);
    const finalBalance = formData.action === 'use' ? currentBalance - displayAmount : currentBalance + displayAmount;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className={`p-6 text-white ${formData.action === 'use' ? 'bg-slate-800' : 'bg-emerald-700'}`}>
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-xl font-bold">{initialData ? 'Edit Transaction' : 'New Transaction'}</h2>
                        <button onClick={onClose} className="text-white/70 hover:text-white"><X size={20}/></button>
                    </div>
                    <div className="flex justify-between items-end">
                        <div>
                            <p className="text-white/70 text-sm">Projected Balance</p>
                            <p className="text-3xl font-mono">{formatNumber(currentBalance)}</p>
                        </div>
                        <div className="text-right">
                             <p className="text-white/70 text-sm">After Transaction</p>
                             <p className="text-xl font-mono font-bold">{formatNumber(finalBalance)}</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                            <AlertCircle size={16} className="mt-0.5 shrink-0"/>
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Date</label>
                            <input 
                                type="date" 
                                required
                                value={formData.date}
                                onChange={e => setFormData({...formData, date: e.target.value})}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Type</label>
                            <select 
                                value={formData.type}
                                onChange={e => setFormData({...formData, type: e.target.value})}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                            >
                                <option value="pto">PTO</option>
                                <option value="sick">Sick Time</option>
                                <option value="personal">Personal</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Operation</label>
                        <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-lg">
                            <button 
                                onClick={() => setFormData({...formData, action: 'use'})}
                                className={`py-2 text-sm font-medium rounded-md transition ${formData.action === 'use' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Use / Spend
                            </button>
                            <button 
                                onClick={() => setFormData({...formData, action: 'add'})}
                                className={`py-2 text-sm font-medium rounded-md transition ${formData.action === 'add' ? 'bg-white shadow text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Manually Add
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                            Amount (Hours)
                        </label>
                        <div className="relative">
                            {formData.action === 'use' && (
                                <span className="absolute left-3 top-2.5 text-gray-500 font-bold">-</span>
                            )}
                            <input 
                                type="number" 
                                min="0"
                                step={currentTypeConfig.increment}
                                value={formData.amount}
                                onChange={e => handleAmountChange(e.target.value)}
                                className={`w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-lg ${formData.action === 'use' ? 'pl-6' : 'pl-3'}`}
                            />
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                            Increment: {currentTypeConfig.increment}h
                        </p>
                    </div>

                    <div>
                         <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                            Note {formData.action === 'add' && <span className="text-red-500">*</span>}
                         </label>
                         <textarea 
                            value={formData.note}
                            onChange={e => setFormData({...formData, note: e.target.value})}
                            rows={2}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                            placeholder="Reason for time off..."
                         />
                    </div>

                    <div className="flex gap-3 pt-2">
                        {initialData && (
                            <button 
                                onClick={() => onDelete(initialData.id)}
                                className="px-4 py-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg font-medium transition"
                            >
                                Delete
                            </button>
                        )}
                        <button 
                            onClick={onClose}
                            className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSave}
                            disabled={!formData.amount || (formData.action === 'add' && !formData.note)}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-medium shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingsForm({ onClose, onSave, currentSettings, transactions, onRestore }) {
    const [localSettings, setLocalSettings] = useState(currentSettings);
    const [newAdjustment, setNewAdjustment] = useState({
        type: 'pto',
        rate: '',
        effectiveDate: '',
        note: ''
    });
    
    // File input ref for restoration
    const fileInputRef = useRef(null);

    const handleAddAdjustment = () => {
        if (!newAdjustment.rate || !newAdjustment.effectiveDate || !newAdjustment.note) return;
        
        setLocalSettings(prev => ({
            ...prev,
            rateAdjustments: [
                ...(prev.rateAdjustments || []),
                {
                    id: crypto.randomUUID(),
                    ...newAdjustment
                }
            ]
        }));

        setNewAdjustment({ type: 'pto', rate: '', effectiveDate: '', note: '' });
    };

    const removeAdjustment = (id) => {
        setLocalSettings(prev => ({
            ...prev,
            rateAdjustments: prev.rateAdjustments.filter(a => a.id !== id)
        }));
    };

    const handleSubmit = () => {
        onSave(localSettings);
    };

    // Full Export Logic
    const handleFullBackup = () => {
        const backupData = {
            version: 1,
            exportDate: new Date().toISOString(),
            settings: currentSettings,
            transactions: transactions
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        const dateStr = new Date().toISOString().split('T')[0];
        link.href = url;
        link.download = `timeoff-backup-${dateStr}.timeoff`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Full Import Logic
    const handleFileRestore = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                // Basic validation
                if (data.settings && Array.isArray(data.transactions)) {
                    onRestore(data);
                } else {
                    alert("Invalid backup file structure.");
                }
            } catch (err) {
                console.error(err);
                alert("Failed to parse backup file.");
            }
            // Clear input so same file can be selected again if needed
            e.target.value = '';
        };
        reader.readAsText(file);
    };

    // Row renderer for table
    const AdjustmentRow = ({ adj }) => {
        const [expanded, setExpanded] = useState(false);
        return (
            <div className="border border-gray-200 rounded-lg bg-gray-50 mb-2 overflow-hidden">
                <div 
                    className="flex justify-between items-center p-3 cursor-pointer hover:bg-gray-100"
                    onClick={() => setExpanded(!expanded)}
                >
                    <div className="flex items-center gap-3">
                        <button className="text-gray-400">
                             {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                        </button>
                        <div>
                             <p className="text-sm font-semibold text-gray-800">{formatDate(adj.effectiveDate)}</p>
                             <p className="text-xs text-gray-500 truncate w-32 md:w-48">{adj.note}</p>
                        </div>
                    </div>
                    <div className="text-right flex items-center gap-3">
                         <div className="text-xs text-right">
                             <span className="block font-bold text-blue-700 uppercase">{adj.type}</span>
                             <span className="block text-gray-600">Rate: {adj.rate}/mo</span>
                         </div>
                         <button 
                            onClick={(e) => { e.stopPropagation(); removeAdjustment(adj.id); }}
                            className="p-1 text-gray-400 hover:text-rose-500 rounded"
                         >
                            <Trash2 size={16} />
                         </button>
                    </div>
                </div>
                {expanded && (
                    <div className="p-3 bg-white border-t border-gray-200 text-xs space-y-1">
                        <p><span className="font-semibold">ID:</span> {adj.id}</p>
                        <p><span className="font-semibold">Type:</span> {DEFAULT_CONFIG[adj.type].label}</p>
                        <p><span className="font-semibold">New Rate:</span> {adj.rate} hours / month (or year for Personal)</p>
                        <p><span className="font-semibold">Note:</span> {adj.note}</p>
                    </div>
                )}
            </div>
        );
    };

    // Sort by effective date
    const sortedAdjustments = [...(localSettings.rateAdjustments || [])].sort((a,b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[85vh] flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 shrink-0">
                    <h2 className="font-bold text-lg text-gray-800">Settings & Rules</h2>
                    <button onClick={onClose}><X size={20} className="text-gray-500"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {/* General Section */}
                    <section>
                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">General Configuration</h3>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Employment Start Date</label>
                            <input 
                                type="date"
                                value={localSettings.startDate}
                                onChange={(e) => setLocalSettings({...localSettings, startDate: e.target.value})}
                                className="w-full md:w-1/2 p-2 border border-gray-300 rounded-lg"
                            />
                            <p className="text-xs text-gray-500 mt-1">Changing this will recalculate all historical accruals from Day 1.</p>
                        </div>
                    </section>

                    {/* Rules Section */}
                    <section>
                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Accrual Rate Adjustments</h3>
                        <p className="text-xs text-gray-500 mb-4">
                            Default rules apply automatically. Use this section to add overrides (e.g., promotions, policy changes) effective from a specific date. 
                            These changes are retroactive.
                        </p>

                        {/* Add New Rule Form */}
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6">
                            <h4 className="text-sm font-bold text-blue-900 mb-3">Add New Adjustment</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                                <div>
                                    <label className="block text-xs font-medium text-blue-800 mb-1">Type</label>
                                    <select 
                                        className="w-full p-2 text-sm border border-blue-200 rounded"
                                        value={newAdjustment.type}
                                        onChange={e => setNewAdjustment({...newAdjustment, type: e.target.value})}
                                    >
                                        <option value="pto">PTO</option>
                                        <option value="sick">Sick Time</option>
                                        <option value="personal">Personal</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-blue-800 mb-1">New Rate (Hrs)</label>
                                    <input 
                                        type="number" 
                                        placeholder="e.g. 12"
                                        className="w-full p-2 text-sm border border-blue-200 rounded"
                                        value={newAdjustment.rate}
                                        onChange={e => setNewAdjustment({...newAdjustment, rate: e.target.value})}
                                    />
                                    <p className="text-[10px] text-blue-600 mt-0.5">Per Month (or Year for Personal)</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-blue-800 mb-1">Effective Date</label>
                                    <input 
                                        type="date"
                                        className="w-full p-2 text-sm border border-blue-200 rounded"
                                        value={newAdjustment.effectiveDate}
                                        onChange={e => setNewAdjustment({...newAdjustment, effectiveDate: e.target.value})}
                                    />
                                </div>
                            </div>
                            <div className="mb-3">
                                <label className="block text-xs font-medium text-blue-800 mb-1">Note (Required)</label>
                                <input 
                                    type="text" 
                                    placeholder="Reason for adjustment..."
                                    className="w-full p-2 text-sm border border-blue-200 rounded"
                                    value={newAdjustment.note}
                                    onChange={e => setNewAdjustment({...newAdjustment, note: e.target.value})}
                                />
                            </div>
                            <div className="text-right">
                                <button 
                                    onClick={handleAddAdjustment}
                                    disabled={!newAdjustment.rate || !newAdjustment.effectiveDate || !newAdjustment.note}
                                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
                                >
                                    Add Adjustment
                                </button>
                            </div>
                        </div>

                        {/* List */}
                        <div className="space-y-2">
                             {sortedAdjustments.length === 0 ? (
                                 <div className="text-center py-4 text-gray-400 text-sm border border-dashed rounded-lg">
                                      No manual adjustments found. Default rules apply.
                                 </div>
                             ) : (
                                sortedAdjustments.map(adj => <AdjustmentRow key={adj.id} adj={adj} />)
                             )}
                        </div>
                    </section>
                    
                    {/* Backup Section */}
                    <section className="pt-4 border-t border-gray-100">
                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Data Management</h3>
                         <p className="text-xs text-gray-500 mb-4">
                            Save a complete backup of your settings and transaction history, or restore from a previous file.
                        </p>
                        <div className="flex gap-4">
                            <button 
                                onClick={handleFullBackup}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition"
                            >
                                <Save size={16} />
                                Backup (.timeoff)
                            </button>
                            
                            <button 
                                onClick={() => fileInputRef.current.click()}
                                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
                            >
                                <Upload size={16} />
                                Restore
                            </button>
                            <input 
                                type="file" 
                                ref={fileInputRef}
                                onChange={handleFileRestore}
                                accept=".timeoff"
                                className="hidden"
                            />
                        </div>
                    </section>
                </div>

                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3 shrink-0">
                      <button 
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSubmit}
                        className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-medium shadow-md transition"
                    >
                        Save & Recalculate
                    </button>
                </div>
            </div>
        </div>
    );
}