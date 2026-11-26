import React, { useRef, useState } from 'react';
import { ArrowLeft, FileDown, Printer } from 'lucide-react';
import { buildStandalonePrintHtml } from '../api';
import type { EmployeeFull } from '../types';

interface PrintableCodesViewProps {
  companyName: string;
  employees: EmployeeFull[];
  onClose: () => void;
}

export const PrintableCodesView: React.FC<PrintableCodesViewProps> = ({
  companyName,
  employees,
  onClose,
}) => {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const activeEmployees = employees.filter((e) => e.is_active === 1);
  const todayFormatted = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const handleExportPdf = async () => {
    if (!window.electronAPI?.printToPDF || !sheetRef.current || exportingPdf) return;
    setExportingPdf(true);
    try {
      const html = buildStandalonePrintHtml(
        sheetRef.current.outerHTML,
        `${companyName} - Codes personnels`
      );
      await window.electronAPI.printToPDF(html, 'codes-employes.pdf');
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 sm:p-10">
      {/* Toolbar hidden on print */}
      <div className="no-print max-w-4xl mx-auto mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour aux employés
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          {window.electronAPI?.isElectron && (
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              <FileDown className="w-4 h-4" />
              {exportingPdf ? 'Export PDF...' : 'Enregistrer en PDF'}
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-950"
          >
            <Printer className="w-4 h-4" />
            Imprimer la feuille des codes
          </button>
        </div>
      </div>

      {/* Printable Sheet */}
      <div ref={sheetRef} className="max-w-4xl mx-auto">
        <div className="mb-6 border-b-2 border-slate-900 pb-4 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              {companyName} — Codes personnels de pointage
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Document confidentiel · Chaque code est personnel et à 6 chiffres.
            </p>
          </div>
          <span className="text-sm font-medium text-slate-600">{todayFormatted}</span>
        </div>

        {activeEmployees.length === 0 ? (
          <p className="text-base text-slate-600">Aucun employé actif.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {activeEmployees.map((emp) => (
              <div
                key={emp.id}
                className="rounded-xl border border-slate-300 p-4 flex items-center justify-between gap-4 break-inside-avoid"
              >
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900 truncate">
                    {emp.first_name} {emp.last_name}
                  </p>
                  <p className="text-sm text-slate-600 truncate">
                    {emp.job_title || 'Employé'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="block text-xs text-slate-500">Code</span>
                  <span className="font-mono text-2xl font-extrabold tracking-widest text-slate-950 tabular-nums">
                    {emp.code}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
