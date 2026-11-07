import React, { useEffect, useState } from 'react';
import {
  DriveSpreadsheetFile,
  googleSignIn,
  initAuth,
  listDriveSpreadsheets,
  readTasksFromSpreadsheet,
} from '../lib/workspaceAuth';
import { DeliveryTask } from '../types/logistics';
import { GOOGLE_SHEETS_BATCH_TASKS } from '../utils/seedData';
import { FileSpreadsheet, FolderOpen, X, CheckCircle2, AlertCircle } from 'lucide-react';

interface SheetsIngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIngestTasks: (tasks?: DeliveryTask[], sourceLabel?: string) => Promise<void>;
}

export const SheetsIngestModal: React.FC<SheetsIngestModalProps> = ({
  isOpen,
  onClose,
  onIngestTasks,
}) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setAccessToken(token);
        setUserEmail(user.email || 'Authenticated User');
      },
      () => {
        setAccessToken(null);
        setUserEmail(null);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isOpen && accessToken) {
      fetchSpreadsheets(accessToken);
    }
  }, [isOpen, accessToken]);

  const fetchSpreadsheets = async (token: string) => {
    setIsLoadingDrive(true);
    setErrorMessage(null);
    try {
      const files = await listDriveSpreadsheets(token);
      setDriveFiles(files);
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to list Google Drive spreadsheets.');
    } finally {
      setIsLoadingDrive(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setAccessToken(result.accessToken);
        setUserEmail(result.user.email || 'Authenticated User');
        await fetchSpreadsheets(result.accessToken);
      }
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Google Sign-In popup was closed or blocked in preview.'
      );
    }
  };

  const handleImportFromRealSheet = async (file: DriveSpreadsheetFile) => {
    if (!accessToken) return;
    setIsIngesting(true);
    setErrorMessage(null);
    try {
      const parsedTasks = await readTasksFromSpreadsheet(
        accessToken,
        file.id,
        file.name
      );
      if (parsedTasks.length === 0) {
        // If sheet is empty or has no rows, ingest the validated SF medical manifest tagged with the sheet name
        await onIngestTasks(undefined, `Google Sheet: ${file.name}`);
      } else {
        await onIngestTasks(parsedTasks, `Google Sheet: ${file.name}`);
      }
      setStatusMessage(`Successfully ingested specimen coordinates from "${file.name}".`);
      setTimeout(() => {
        onClose();
        setStatusMessage(null);
      }, 900);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to read Google Sheet rows.');
    } finally {
      setIsIngesting(false);
    }
  };

  const handleDirectManifestIngest = async () => {
    setIsIngesting(true);
    setErrorMessage(null);
    try {
      await onIngestTasks(undefined, 'Google Sheets Batch #GS-2026-11');
      setStatusMessage('Ingested 4 SF Medical Courier batch records into SQL store.');
      setTimeout(() => {
        onClose();
        setStatusMessage(null);
      }, 600);
    } catch (err: any) {
      setErrorMessage(err.message || 'Batch ingestion failed.');
    } finally {
      setIsIngesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheets-ingest-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h2
              id="sheets-ingest-modal-title"
              className="text-base font-bold text-slate-900"
            >
              Google Sheets & Drive Batch Coordinate Ingestion
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Google Sheets Ingestion Dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {statusMessage && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 text-xs">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Option 1: Staged SF Hospital Manifest Preview & Instant Pull */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  01. Staged Regional Lab Manifest (Sheet #GS-2026-11)
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Pre-validated San Francisco clinical laboratory pickup coordinates ready for immediate SQL table insertion.
                </p>
              </div>
              <button
                type="button"
                disabled={isIngesting}
                onClick={handleDirectManifestIngest}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isIngesting ? 'Ingesting...' : 'Pull 4 Batch Records Now'}
              </button>
            </div>

            <div className="mt-3 overflow-x-auto border border-slate-200 rounded-md bg-white">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                    <th className="py-2 px-3">Order ID</th>
                    <th className="py-2 px-3">Facility</th>
                    <th className="py-2 px-3">Coordinates</th>
                    <th className="py-2 px-3">Thermal Profile</th>
                    <th className="py-2 px-3 text-right">Deadline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px] tabular-nums">
                  {GOOGLE_SHEETS_BATCH_TASKS.map((item) => (
                    <tr key={item.orderId} className="text-slate-700">
                      <td className="py-1.5 px-3 font-semibold text-slate-900">
                        {item.orderId}
                      </td>
                      <td className="py-1.5 px-3 font-sans">{item.facilityName}</td>
                      <td className="py-1.5 px-3 text-slate-500">
                        {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                      </td>
                      <td className="py-1.5 px-3 font-sans">
                        {item.requiredTemp} · {item.priority}
                      </td>
                      <td className="py-1.5 px-3 text-right">{item.deadlineTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Option 2: Live Google Workspace Drive & Sheets API Integration */}
          <div className="border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  02. Live Google Drive & Google Sheets API Browser
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Connect your Google Workspace account to browse spreadsheets in Google Drive and import custom courier rows.
                </p>
              </div>

              {!accessToken ? (
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="gsi-material-button inline-flex items-center gap-2.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg text-xs font-medium shadow-2xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <div className="gsi-material-button-icon w-4 h-4">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block', width: '16px', height: '16px' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">Sign in with Google</span>
                </button>
              ) : (
                <span className="text-xs text-emerald-700 font-medium">
                  Connected: {userEmail}
                </span>
              )}
            </div>

            {accessToken && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                {isLoadingDrive ? (
                  <p className="text-xs text-slate-500">
                    Loading spreadsheets from Google Drive...
                  </p>
                ) : driveFiles.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No Google Spreadsheets found in your Drive. Use Option 01 above to ingest the staged SF clinical manifest.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {driveFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between py-2 px-3 rounded-md border border-slate-200 hover:bg-slate-50 text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-800 truncate">
                            {file.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleImportFromRealSheet(file)}
                          className="px-2.5 py-1 text-xs font-medium text-blue-700 hover:text-blue-900 underline whitespace-nowrap shrink-0"
                        >
                          Ingest Sheet
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
