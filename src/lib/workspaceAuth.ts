import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import baseConfig from '../../firebase-applet-config.json';
import { DeliveryTask, TaskPriority, TemperatureCapacity } from '../types/logistics';

const firebaseConfig = {
  ...baseConfig,
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || baseConfig.apiKey || '',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve Google Workspace access token');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google Workspace sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutWorkspace = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export interface DriveSpreadsheetFile {
  id: string;
  name: string;
  modifiedTime: string;
}

/**
 * Lists Google Sheets files from the user's Google Drive using drive.readonly scope.
 */
export async function listDriveSpreadsheets(
  accessToken: string
): Promise<DriveSpreadsheetFile[]> {
  const query = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=12&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google Drive API error (${res.status})`);
  }
  const data = await res.json();
  return data.files || [];
}

/**
 * Reads delivery tasks from a selected Google Sheet using spreadsheets.readonly scope.
 * Dynamically inspects spreadsheet metadata first so it never assumes "Sheet1".
 */
export async function readTasksFromSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTitleLabel: string
): Promise<DeliveryTask[]> {
  // 1. Fetch spreadsheet metadata to discover the first sheet tab name
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!metaRes.ok) {
    throw new Error(`Google Sheets metadata error (${metaRes.status})`);
  }
  const metaData = await metaRes.json();
  const firstSheetTitle: string =
    metaData?.sheets?.[0]?.properties?.title || 'Sheet1';

  // 2. Fetch values from the discovered sheet tab
  const range = encodeURIComponent(`${firstSheetTitle}!A1:H50`);
  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!valRes.ok) {
    throw new Error(`Google Sheets values error (${valRes.status})`);
  }
  const valData = await valRes.json();
  const rows: string[][] = valData.values || [];

  if (rows.length <= 1) {
    return [];
  }

  // Parse rows skipping header row
  const tasks: DeliveryTask[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const orderId = (r[0] || `GS-${1000 + i}`).trim();
    const facilityName = (r[1] || `San Francisco Clinical Site #${i}`).trim();
    const lat = parseFloat(r[2]) || 37.765 + (i % 5) * 0.006;
    const lng = parseFloat(r[3]) || -122.415 - (i % 5) * 0.008;
    const specimenType = (r[4] || 'Cryopreserved Diagnostic Specimen').trim();
    const rawTemp = (r[5] || 'Refrigerated').trim();
    const requiredTemp: TemperatureCapacity =
      rawTemp === 'Frozen' || rawTemp === 'Ambient' || rawTemp === 'Refrigerated'
        ? rawTemp
        : 'Refrigerated';
    const rawPriority = (r[6] || 'STAT').trim().toUpperCase();
    const priority: TaskPriority = rawPriority === 'STAT' ? 'STAT' : 'Routine';
    const deadlineTime = (r[7] || '10:30').trim();

    tasks.push({
      orderId,
      status: 'Pending',
      facilityName,
      address: `${facilityName}, San Francisco, CA`,
      lat,
      lng,
      specimenType,
      requiredTemp,
      priority,
      deadlineTime,
      assignedVehicleId: null,
      stopSequence: null,
      estimatedArrival: null,
      distanceKm: null,
      batchSource: `Sheet: ${sheetTitleLabel}`,
    });
  }

  return tasks;
}
