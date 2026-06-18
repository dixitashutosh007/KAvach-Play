"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import {
  RefreshCw,
  FileSpreadsheet,
  Key,
  AlertCircle,
  TrendingUp,
  Users,
  Check,
  Trash2,
  Archive,
  FileText,
  Clipboard,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase";

interface PlayerStatus {
  name: string;
  paid: boolean;
}

export default function WixFinanceView({
  store,
}: {
  store: ReturnType<typeof useStore>;
}) {
  const [spreadsheetId, setSpreadsheetId] = useState(() => {
    if (typeof window !== "undefined")
      return (
        localStorage.getItem("wix_finance_spreadsheet_id") ||
        "1k9HUh3rdae1dqNOgXECG_KCTVz_B_AsTtpPuMu-0IFc"
      );
    return "1k9HUh3rdae1dqNOgXECG_KCTVz_B_AsTtpPuMu-0IFc";
  });
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("wix_finance_access_token") || null;
    return null;
  });
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorArr, setErrorArr] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState<"success" | "error" | "info">(
    "info",
  );

  const handleSpreadsheetIdChange = (id: string) => {
    setSpreadsheetId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("wix_finance_spreadsheet_id", id);
    }
  };

  const handleDisconnect = (silent = false) => {
    setAccessToken(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("wix_finance_access_token");
    }
    if (!silent) showStatus("Disconnected from Google Sheets.", "info");
  };

  const handleApiError = (err: any, fallbackMsg: string) => {
    console.error(err);
    const errMsg = err?.message || String(err);
    if (
      errMsg.includes("401") ||
      errMsg.includes("UNAUTHENTICATED") ||
      errMsg.includes("403")
    ) {
      handleDisconnect(true);
      showStatus("Session expired. Please reconnect.", "error");
      setErrorArr((prev) => [...prev, "API Error - " + errMsg]);
    } else {
      setErrorArr((prev) => [...prev, errMsg]);
      showStatus(fallbackMsg, "error");
    }
  };

  // Collected data states
  const [dashboardData, setDashboardData] = useState<string[][]>([]);
  const [rosterData, setRosterData] = useState<Record<string, PlayerStatus[]>>(
    {},
  );
  const [selectedMatch, setSelectedMatch] = useState("");
  const [paymentsData, setPaymentsData] = useState<string[][]>([]);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const PAYMENTS_PER_PAGE = 10;
  const MAX_PAYMENTS = 50;

  // Input states
  const [playerName, setPlayerName] = useState("");
  const [unpaidNamesText, setUnpaidNamesText] = useState("");
  const [isArchiving, setIsArchiving] = useState(false);
  const [reportPreview, setReportPreview] = useState("");

  const showStatus = (
    msg: string,
    type: "success" | "error" | "info" = "success",
  ) => {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => {
      setStatusMsg("");
    }, 4500);
  };

  const handleGoogleLogin = async () => {
    setIsAuthenticating(true);
    setErrorArr([]);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/spreadsheets");
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      if (token) {
        setAccessToken(token);
        if (typeof window !== "undefined") {
          localStorage.setItem("wix_finance_access_token", token);
          localStorage.setItem("wix_finance_spreadsheet_id", spreadsheetId);
        }
        showStatus("Google Sheets Account Connected Successfully!", "success");
      } else {
        throw new Error("Failed to get spreadsheet access token.");
      }
    } catch (err: any) {
      if (err?.code === "auth/popup-closed-by-user") {
        console.warn("Popup closed by user.");
        return;
      }
      if (
        err?.code === "auth/popup-blocked" ||
        err?.message?.includes("popup-blocked")
      ) {
        const isIFrame =
          typeof window !== "undefined" && window.self !== window.top;
        let msg =
          "The login popup was blocked by your browser. Please allow popups for this site or open the application in a new tab.";
        if (isIFrame)
          msg +=
            "\n\nNote: If you are seeing this inside the AI Studio frame, third-party sign-in popups are blocked. Please click the 'Open in new window' button in the top-right corner to run the application in a dedicated tab.";
        alert(msg);
      } else {
        handleApiError(err, "Connection Failed. See error list.");
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const fetchSheetValues = async (range: string, token: string) => {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("wix_finance_access_token");
      }
      setAccessToken(null);
      throw new Error(
        `Your Google Sheets session has expired. Please reconnect.`,
      );
    }
    if (!res.ok) {
      const errText = await res.text();
      let parsed = errText;
      try {
        parsed = JSON.parse(errText).error.message;
      } catch (e) {}
      throw new Error(`Sheets API Error: ${parsed}`);
    }
    const data = await res.json();
    return data.values || [];
  };

  const loadData = async (token = accessToken) => {
    if (!token) return;
    setLoading(true);
    setErrorArr([]);
    try {
      // 1. Fetch Dashboard table values
      const dashValues = await fetchSheetValues("Dashboard!A1:C200", token);
      // Remove headers and filter out empty rows
      const trimmedDash = dashValues
        .slice(1)
        .filter((row: string[]) => row[0] && row[0].trim());
      setDashboardData(trimmedDash);

      // 2. Fetch Match Wise Data & Unpaid Players sheet to construct merged rosters
      const paidValues = await fetchSheetValues(
        "Match Wise Data!A1:Z500",
        token,
      );

      let unpaidValues: string[][] = [];
      try {
        unpaidValues = await fetchSheetValues("Unpaid Players!A1:Z500", token);
      } catch (err) {
        console.warn("Unpaid Players sheet not populated or empty:", err);
      }

      // 3. Fetch Sheet1 for detailed payments history
      let sheet1Values: string[][] = [];
      try {
        sheet1Values = await fetchSheetValues("Sheet1!A1:J2000", token);
        // Exclude header row and empty rows, then reverse for newest first
        const validPayments = sheet1Values
          .slice(1)
          .filter((row: string[]) => row[0] && row[0].trim());
        setPaymentsData(validPayments.reverse());
      } catch (err) {
        console.warn("Failed to fetch Sheet1 payments history:", err);
      }

      // Merging process
      const results: Record<string, PlayerStatus[]> = {};
      if (paidValues.length > 0 && paidValues[0].length > 0) {
        paidValues[0].forEach((header: string, colIdx: number) => {
          if (!header) return;
          const match = header.toString().trim();
          results[match] = [];

          // Log paid players under this col
          for (let r = 1; r < paidValues.length; r++) {
            if (
              paidValues[r] &&
              paidValues[r][colIdx] &&
              paidValues[r][colIdx].trim()
            ) {
              results[match].push({
                name: paidValues[r][colIdx].trim(),
                paid: true,
              });
            }
          }

          // Merge unpaid players
          if (unpaidValues.length > 0 && unpaidValues[0].length > 0) {
            const unCol = unpaidValues[0]
              .map((h: string) => h.trim())
              .indexOf(match);
            if (unCol !== -1) {
              for (let r = 1; r < unpaidValues.length; r++) {
                if (
                  unpaidValues[r] &&
                  unpaidValues[r][unCol] &&
                  unpaidValues[r][unCol].trim()
                ) {
                  results[match].push({
                    name: unpaidValues[r][unCol].trim(),
                    paid: false,
                  });
                }
              }
            }
          }
        });
      }

      setRosterData(results);
      showStatus("Synchronized with Google Sheets successfully!", "success");
    } catch (err: any) {
      handleApiError(
        err,
        "Sync Error occurred. Please verify sheet coordinates and tab titles.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) {
      setTimeout(() => loadData(accessToken), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const updateDashboardSheet = async (
    token: string,
    sheet1Data?: string[][],
  ) => {
    const rawData =
      sheet1Data || (await fetchSheetValues("Sheet1!A1:J1000", token));

    const matchData: Record<string, { players: Set<string>; revenue: number }> =
      {};

    // Aggregate match data (skip header row index 0)
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row) continue;
      const rawPlayer = row[0];
      const rawMatch = row[4];
      const amount = parseFloat(row[2]) || 0;

      if (rawMatch && rawPlayer) {
        const mKey = rawMatch.toString().trim();
        const pKey = rawPlayer.toString().trim();

        if (!matchData[mKey]) {
          matchData[mKey] = { players: new Set(), revenue: 0 };
        }
        matchData[mKey].players.add(pKey);
        matchData[mKey].revenue += amount;
      }
    }

    const dashResults = [["Match", "Unique Players", "Total Revenue"]];
    const paidHeaders: string[] = [];
    const paidValues: string[][] = [];

    Object.keys(matchData)
      .sort()
      .forEach((m: string) => {
        dashResults.push([
          m,
          String(matchData[m].players.size),
          String(matchData[m].revenue),
        ]);
        paidHeaders.push(m);
        paidValues.push(Array.from(matchData[m].players));
      });

    // Overwrite Dashboard sheet content
    const dashClearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Dashboard!A:C:clear`;
    await fetch(dashClearUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const dashWriteUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Dashboard!A1?valueInputOption=USER_ENTERED`;
    await fetch(dashWriteUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: dashResults }),
    });

    // Clear and Overwrite Match Wise Data sheet content
    const paidClearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Match Wise Data!A:Z:clear`;
    await fetch(paidClearUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (paidHeaders.length > 0) {
      const paidWriteUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Match Wise Data!A1?valueInputOption=USER_ENTERED`;

      const maxRows = Math.max(...paidValues.map((v: string[]) => v.length));
      const outputMatrix: string[][] = [paidHeaders];
      for (let r = 0; r < maxRows; r++) {
        outputMatrix.push(
          paidHeaders.map((_, colIndex) => paidValues[colIndex][r] || ""),
        );
      }

      await fetch(paidWriteUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: outputMatrix }),
      });
    }
  };

  const handleAddPaid = async () => {
    if (!selectedMatch || !playerName.trim() || !accessToken) return;
    setLoading(true);
    try {
      const cleanM = selectedMatch.trim();
      const rawData = await fetchSheetValues("Sheet1!A1:J1000", accessToken);

      let fee = 0;
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (row && row[4] && row[4].toString().trim() === cleanM) {
          fee = parseFloat(row[2]) || 0;
          break;
        }
      }

      const now = new Date();
      // Formats IST Date
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const istDate = new Date(utc + 3600000 * 5.5);
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      const istFormatted = `${String(istDate.getDate()).padStart(2, "0")}-${months[istDate.getMonth()]}-${String(istDate.getFullYear()).slice(-2)} ${String(istDate.getHours()).padStart(2, "0")}:${String(istDate.getMinutes()).padStart(2, "0")}`;

      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:J1:append?valueInputOption=USER_ENTERED`;
      await fetch(appendUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [
            [
              playerName.trim(),
              "(Manual)",
              String(fee),
              "MANUAL_ENTRY",
              cleanM,
              now.toISOString(),
              "1",
              "",
              "",
              istFormatted,
            ],
          ],
        }),
      });

      await updateDashboardSheet(accessToken);
      setPlayerName("");
      showStatus("Logged payment manually inside Sheet1!", "success");
      await loadData(accessToken);
    } catch (err: any) {
      handleApiError(err, "Manual sheet entry failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddUnpaid = async () => {
    if (!selectedMatch || !unpaidNamesText.trim() || !accessToken) return;
    setLoading(true);
    const names = unpaidNamesText
      .split("\n")
      .map((n: string) => n.trim())
      .filter((n: string) => n);
    try {
      const cleanM = selectedMatch.trim();
      const grid = await fetchSheetValues(
        "Unpaid Players!A1:Z500",
        accessToken,
      );

      const headers = grid[0] || [];
      let colIdx = headers.map((h: string) => h.trim()).indexOf(cleanM);

      const newGrid = [...grid];
      if (colIdx === -1) {
        if (newGrid.length === 0) {
          newGrid.push([]);
        }
        newGrid[0].push(cleanM);
        colIdx = newGrid[0].length - 1;
      }

      names.forEach((p: string) => {
        let r = 1;
        while (true) {
          if (!newGrid[r]) {
            newGrid[r] = [];
          }
          if (!newGrid[r][colIdx] || !newGrid[r][colIdx].trim()) {
            newGrid[r][colIdx] = p;
            break;
          }
          r++;
        }
      });

      // Overwrite Unpaid Players sheet with padded matrix grid layout
      const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Unpaid Players!A:Z:clear`;
      await fetch(clearUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const maxCols = Math.max(...newGrid.map((row: string[]) => row.length));
      const finalGrid = newGrid.map((row: string[]) => {
        const r = [...row];
        while (r.length < maxCols) {
          r.push("");
        }
        return r;
      });

      const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Unpaid Players!A1?valueInputOption=USER_ENTERED`;
      await fetch(writeUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: finalGrid }),
      });

      setUnpaidNamesText("");
      showStatus("Unpaid players roster updated!", "success");
      await loadData(accessToken);
    } catch (err: any) {
      handleApiError(err, "Action failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveUnpaid = async (name: string) => {
    if (!selectedMatch || !name || !accessToken) return;
    const confirmed = window.confirm(
      `Remove "${name}" from unpaid match roster in Google Sheets?`,
    );
    if (!confirmed) return;
    setLoading(true);
    try {
      const cleanM = selectedMatch.trim();
      const grid = await fetchSheetValues(
        "Unpaid Players!A1:Z500",
        accessToken,
      );
      if (grid.length === 0) return;

      const headers = grid[0] || [];
      const colIdx = headers.map((h: string) => h.trim()).indexOf(cleanM);
      if (colIdx === -1) return;

      let foundRow = -1;
      for (let r = 1; r < grid.length; r++) {
        if (
          grid[r] &&
          grid[r][colIdx] &&
          grid[r][colIdx].trim() === name.trim()
        ) {
          foundRow = r;
          break;
        }
      }

      if (foundRow === -1) return;

      // Shift columns elements below found row UP by 1 cell
      for (let r = foundRow; r < grid.length - 1; r++) {
        if (!grid[r]) grid[r] = [];
        if (!grid[r + 1]) grid[r + 1] = [];
        grid[r][colIdx] = grid[r + 1][colIdx] || "";
      }
      grid[grid.length - 1][colIdx] = "";

      // Override
      const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Unpaid Players!A:Z:clear`;
      await fetch(clearUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const maxCols = Math.max(...grid.map((row: string[]) => row.length));
      const finalGrid = grid.map((row: string[]) => {
        const r = [...row];
        while (r.length < maxCols) {
          r.push("");
        }
        return r;
      });

      const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Unpaid Players!A1?valueInputOption=USER_ENTERED`;
      await fetch(writeUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: finalGrid }),
      });

      showStatus(`Removed "${name}" from unpaid list.`, "success");
      await loadData(accessToken);
    } catch (err: any) {
      handleApiError(err, "Action failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleOverviewReport = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const grid = await fetchSheetValues(
        "Unpaid Players!A1:Z500",
        accessToken,
      );
      if (grid.length === 0) {
        setReportPreview("No unpaid records found.");
        return;
      }

      const headers = grid[0] || [];
      let reportText = "⚽ *PENDING PAYMENTS REPORT* ⚽\n\n";
      let hasData = false;

      for (let col = 0; col < headers.length; col++) {
        const mName = headers[col];
        if (!mName) continue;

        const players: string[] = [];
        for (let row = 1; row < grid.length; row++) {
          if (grid[row] && grid[row][col] && grid[row][col].trim()) {
            players.push(grid[row][col].trim());
          }
        }

        if (players.length > 0) {
          hasData = true;
          reportText += `📌 *${mName.toString().toUpperCase()}*\n`;
          players.forEach((item, idx) => {
            reportText += `${idx + 1}. ${item}\n`;
          });
          reportText += "\n";
        }
      }

      const finalReport = hasData
        ? reportText.trim()
        : "All clear! Every player has paid. ✅";
      setReportPreview(finalReport);

      // Auto-copy to clipboard
      await navigator.clipboard.writeText(finalReport);
      showStatus("Combined report copied to clipboard!", "success");
    } catch (err: any) {
      handleApiError(err, "Report generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!selectedMatch || !accessToken) return;

    setLoading(true);
    setIsArchiving(true);
    try {
      const cleanMatch = selectedMatch.trim();

      // 1. Fetch count
      const sheet1Data = await fetchSheetValues("Sheet1!A1:J1000", accessToken);
      let count = 0;
      for (let i = 1; i < sheet1Data.length; i++) {
        if (
          sheet1Data[i] &&
          sheet1Data[i][4] &&
          sheet1Data[i][4].toString().trim() === cleanMatch
        )
          count++;
      }

      // 2. Prompt user
      const consent = window.confirm(
        `Analyzed match data found: ${count} entries. Moving everything to the "Archived" tab, deleting column from "Unpaid Players", and updating dashboard. Proceed?`,
      );
      if (!consent) {
        setLoading(false);
        setIsArchiving(false);
        return;
      }

      const headers = sheet1Data[0] || [
        "Player",
        "Type",
        "Amount",
        "Item",
        "Match",
        "Date",
        "Qty",
        "Placeholder1",
        "Placeholder2",
        "IST Date",
      ];
      const rowsToArchive: string[][] = [];
      const rowsToKeep: string[][] = [headers];

      for (let r = 1; r < sheet1Data.length; r++) {
        const row = sheet1Data[r];
        if (!row) continue;
        if (row[4] && row[4].toString().trim() === cleanMatch) {
          const paddedRow = [...row];
          while (paddedRow.length < 10) paddedRow.push("");
          rowsToArchive.push(paddedRow.slice(0, 10));
        } else {
          rowsToKeep.push(row);
        }
      }

      // Append to Archived
      if (rowsToArchive.length > 0) {
        const archiveUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Archived!A1:J1:append?valueInputOption=USER_ENTERED`;
        await fetch(archiveUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ values: rowsToArchive }),
        });
      }

      // Overwrite Sheet1 values
      const clearSheet1Url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:J:clear`;
      await fetch(clearSheet1Url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const writeSheet1Url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1?valueInputOption=USER_ENTERED`;
      await fetch(writeSheet1Url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: rowsToKeep }),
      });

      // Remove column from Unpaid Players
      const unpaidGrid = await fetchSheetValues(
        "Unpaid Players!A1:Z500",
        accessToken,
      );
      if (unpaidGrid.length > 0) {
        const unpaidHeaders = unpaidGrid[0];
        const colIdx = unpaidHeaders
          .map((h: string) => h.trim())
          .indexOf(cleanMatch);
        if (colIdx !== -1) {
          const updatedUnpaidGrid = unpaidGrid.map((row: string[]) => {
            const copyRow = [...row];
            copyRow.splice(colIdx, 1);
            return copyRow;
          });

          const clearUnpaidUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Unpaid Players!A:Z:clear`;
          await fetch(clearUnpaidUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          const maxCols = Math.max(
            ...updatedUnpaidGrid.map((row: string[]) => row.length),
          );
          const finalUnpaidGrid = updatedUnpaidGrid.map((row: string[]) => {
            const r = [...row];
            while (r.length < maxCols) {
              r.push("");
            }
            return r;
          });

          const writeUnpaidUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Unpaid Players!A1?valueInputOption=USER_ENTERED`;
          await fetch(writeUnpaidUrl, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ values: finalUnpaidGrid }),
          });
        }
      }

      // Update Dashboard matrix
      await updateDashboardSheet(accessToken, rowsToKeep);
      setSelectedMatch("");
      showStatus("Active match payments successfully archived!", "success");
      await loadData(accessToken);
    } catch (err: any) {
      handleApiError(err, "Arching payments failed.");
    } finally {
      setLoading(false);
      setIsArchiving(false);
    }
  };

  const handleSyncRecalculate = async () => {
    if (!accessToken) return;
    setLoading(true);
    setErrorArr([]);
    try {
      await updateDashboardSheet(accessToken);
      await loadData(accessToken);
      showStatus(
        "Dashboard recalculated and rebuilt perfectly from Sheet1!",
        "success",
      );
    } catch (err: any) {
      handleApiError(err, "Recalculation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-accent" /> Wix Finance Sync
          </h2>
          <p className="text-xs text-white/50 mt-1">
            Tracks, registers, and syncs payments ingested into Google Sheets
            from your Wix-hosted website.
          </p>
        </div>

        {accessToken && (
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              onClick={() => handleSyncRecalculate()}
              disabled={loading}
              className="w-full sm:w-auto bg-accent text-black font-bold px-4 py-2 rounded-lg text-xs tracking-wider uppercase hover:bg-accent/80 transition flex items-center justify-center gap-2"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />{" "}
              Recalculate Dashboard
            </button>
            <button
              onClick={() => handleDisconnect(false)}
              className="w-full sm:w-auto bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 text-red-400 font-bold px-4 py-2 rounded-lg text-xs tracking-wider uppercase transition flex items-center justify-center gap-1"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {statusMsg && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center gap-2.5 ${
            statusType === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : statusType === "error"
                ? "bg-red-500/10 border-red-500/30 text-red-400"
                : "bg-white/5 border-glass-border text-white/80"
          }`}
        >
          <div className="w-2 h-2 rounded-full animate-ping shrink-0 bg-current" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorArr.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs space-y-1.5 text-red-300">
          <div className="font-bold flex items-center gap-2 uppercase tracking-wide text-[10px]">
            <ShieldAlert className="w-4 h-4 text-red-400" /> API / Execution
            Warnings Stack:
          </div>
          <ul className="list-disc pl-4 space-y-1">
            {errorArr.map((err, i) => (
              <li key={i} className="font-mono">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Connection setup is displayed if no accessToken found */}
      {!accessToken ? (
        <div className="glass rounded-xl p-6 text-center space-y-4 border border-glass-border">
          <div className="w-12 h-12 rounded-full bg-accent/15 border border-accent/20 flex items-center justify-center mx-auto text-accent">
            <Key className="w-6 h-6 animate-pulse" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="font-bold text-white">
              Google Sheet Access Required
            </h3>
            <p className="text-white/60 text-xs">
              To fetch, calculate, and register payments, connect the Google
              account holding permission to update your Wix Payment Sync
              spreadsheet.
            </p>
          </div>

          <div className="max-w-md mx-auto space-y-3 pt-2">
            <div>
              <label className="text-[10px] text-white/40 block text-left mb-1.5 uppercase tracking-widest font-bold">
                Google Spreadsheet ID
              </label>
              <input
                type="text"
                value={spreadsheetId}
                onChange={(e) => handleSpreadsheetIdChange(e.target.value)}
                placeholder="Google Spreadsheet ID"
                className="bg-black/40 border border-glass-border rounded-lg px-3 py-2.5 text-xs text-white uppercase focus:outline-none focus:border-accent w-full font-mono"
              />
            </div>

            <button
              onClick={handleGoogleLogin}
              disabled={isAuthenticating}
              className="w-full bg-accent text-black font-extrabold py-3 rounded-xl hover:bg-accent/90 transition shadow-lg flex items-center justify-center gap-2 cursor-pointer mt-4"
            >
              Connect Google Sheets
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Active Collections Summary */}
          <div className="lg:col-span-5 h-full">
            <div className="glass rounded-xl p-5 border border-glass-border h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/70 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" /> Live
                  Collections
                </h3>
                <span className="text-[9px] font-mono text-white/30 uppercase">
                  Updated dynamically
                </span>
              </div>

              {dashboardData.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-white/40 italic text-xs border border-dashed border-glass-border/30 rounded-xl bg-white/[0.01]">
                  No active collection rows found in Dashboard. Click
                  Recalculate Dashboard above to parse from Sheet1.
                </div>
              ) : (
                <div className="flex-1 space-y-2 overflow-y-auto max-h-[360px]">
                  <table className="w-full text-left text-xs text-white/80 border-collapse">
                    <thead>
                      <tr className="border-b border-glass-border text-white/40 font-bold uppercase text-[9px] tracking-widest">
                        <th className="pb-2">Match Name</th>
                        <th className="pb-2 text-center">Paid</th>
                        <th className="pb-2 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/50">
                      {dashboardData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition">
                          <td className="py-2.5 font-semibold truncate max-w-[160px]">
                            {row[0]}
                          </td>
                          <td className="py-2.5 text-center font-bold text-white">
                            {row[1]}
                          </td>
                          <td className="py-2.5 text-right font-mono font-black text-accent">
                            ₹{parseFloat(row[2]).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="pt-4 mt-4 border-t border-glass-border space-y-2">
                <button
                  onClick={handleOverviewReport}
                  className="w-full bg-white/5 hover:bg-white/10 transition border border-glass-border text-white font-bold py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-accent" /> Copier Combined
                  WhatsApp Unpaid Report
                </button>

                {reportPreview && (
                  <div className="relative bg-black/60 border border-white/5 p-3 rounded-lg font-mono text-[10px] text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-[160px] overflow-y-auto">
                    <span className="absolute top-2 right-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[8px] font-bold px-1.5 py-0.5 rounded tracking-widest uppercase">
                      Copied!
                    </span>
                    {reportPreview}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Roster & Actions Section */}
          <div className="lg:col-span-7">
            <div className="glass rounded-xl p-5 border border-glass-border space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/70 flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" /> Auditor & Roster
                  Panel
                </h3>
                <p className="text-[11px] text-white/40 mt-1">
                  Select an active match from Google Sheets to add/delete unpaid
                  match rosters or archive totals.
                </p>
              </div>

              <div>
                <label className="text-[9px] text-white/40 uppercase block mb-1 font-bold tracking-widest">
                  Active Match Selector
                </label>
                <select
                  value={selectedMatch}
                  onChange={(e) => setSelectedMatch(e.target.value)}
                  className="w-full bg-black/40 border border-glass-border rounded-lg py-2.5 px-3 text-xs text-white focus:outline-none focus:border-accent font-semibold [&>option]:bg-emerald-950 appearance-none cursor-pointer"
                >
                  <option value="">-- Choose Match --</option>
                  {Object.keys(rosterData).map((mKey, i) => (
                    <option key={i} value={mKey}>
                      {mKey}
                    </option>
                  ))}
                </select>
              </div>

              {selectedMatch && (
                <div className="space-y-5 pt-2 border-t border-glass-border/40">
                  {/* Single Player Paid Form */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-8">
                      <label className="text-[9px] text-white/40 uppercase block mb-1 font-bold tracking-widest">
                        Add Paid Player Name
                      </label>
                      <input
                        type="text"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        placeholder="e.g. Rahul Sharma"
                        className="bg-black/40 border border-glass-border rounded-lg text-xs py-2 px-3 text-white focus:outline-none focus:border-accent w-full"
                      />
                    </div>
                    <button
                      onClick={handleAddPaid}
                      disabled={loading || !playerName.trim()}
                      className="sm:col-span-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-extrabold text-xs py-2 px-3 rounded-lg hover:bg-emerald-500/20 transition flex items-center justify-center gap-1.5 disabled:opacity-50 h-[38px]"
                    >
                      <Check className="w-3.5 h-3.5" /> Log Paid Entry
                    </button>
                  </div>

                  {/* Bulk Unpaid Form */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-white/40 uppercase block mb-1 font-bold tracking-widest">
                      Paste Unpaid Names (One name per line)
                    </label>
                    <textarea
                      value={unpaidNamesText}
                      onChange={(e) => setUnpaidNamesText(e.target.value)}
                      placeholder="Abhishek Sen&#10;Vikram Singh&#10;Pradeep Roy"
                      rows={3}
                      className="bg-black/40 border border-glass-border rounded-lg text-xs p-2 px-3 text-white focus:outline-none focus:border-accent w-full font-mono"
                    />
                    <button
                      onClick={handleAddUnpaid}
                      disabled={loading || !unpaidNamesText.trim()}
                      className="w-full bg-white/5 hover:bg-white/10 transition border border-glass-border text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-accent" /> Add to Unpaid
                      Roster Columns
                    </button>
                  </div>

                  {/* Roster list representation */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-widest text-white/40">
                      <span>
                        Roster Players list (
                        {rosterData[selectedMatch]?.length || 0})
                      </span>
                      <span>Manage Column</span>
                    </div>

                    {!rosterData[selectedMatch] ||
                    rosterData[selectedMatch].length === 0 ? (
                      <div className="text-center py-6 text-white/30 text-xs italic border border-glass-border/30 rounded-lg bg-white/[0.01]">
                        No players registered under this active match yet.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                        {rosterData[selectedMatch].map((p, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 border border-glass-border text-xs"
                          >
                            <span className="flex items-center gap-2 font-medium">
                              <span className="text-[10px] text-white/30 font-mono">
                                {index + 1}.
                              </span>
                              <span
                                className={
                                  p.paid
                                    ? "text-emerald-400"
                                    : "text-amber-400 font-bold"
                                }
                              >
                                {p.paid ? "✅" : "⏳"}
                              </span>
                              <span>{p.name}</span>
                            </span>

                            {!p.paid && (
                              <button
                                onClick={() => handleRemoveUnpaid(p.name)}
                                className="text-[10px] text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded hover:bg-red-400/20 transition flex items-center gap-1 cursor-pointer font-bold"
                              >
                                <Trash2 className="w-3 h-3" /> Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Archive button */}
                  <div className="pt-2">
                    <button
                      onClick={handleArchive}
                      disabled={loading || isArchiving}
                      className="w-full bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition text-xs font-black uppercase tracking-wider py-3 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Archive className="w-4 h-4" /> Archive Match Data
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Render Payments History if accessToken is present and not loading */}
      {accessToken && !loading && paymentsData.length > 0 && (
        <div className="glass rounded-xl p-5 border border-glass-border space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/70 flex items-center gap-2">
            <Clipboard className="w-5 h-5 text-accent" /> Recent Payments
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-white/80 border-collapse">
              <thead>
                <tr className="border-b border-glass-border text-white/40 font-bold uppercase text-[9px] tracking-widest">
                  <th className="pb-2">Date (IST)</th>
                  <th className="pb-2">Player Name</th>
                  <th className="pb-2">Match</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border/50">
                {paymentsData
                  .slice(
                    (paymentsPage - 1) * PAYMENTS_PER_PAGE,
                    paymentsPage * PAYMENTS_PER_PAGE,
                  )
                  .map((row, idx) => (
                    <tr key={idx} className="hover:bg-white/5 transition">
                      <td className="py-2.5 whitespace-nowrap text-[10px] text-white/60">
                        {row[9] || "-"}
                      </td>
                      <td className="py-2.5 font-semibold">{row[0]}</td>
                      <td className="py-2.5">{row[4]}</td>
                      <td className="py-2.5 text-right font-mono font-black text-accent">
                        ₹{parseFloat(row[2]).toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {paymentsData.length > PAYMENTS_PER_PAGE && (
            <div className="flex items-center justify-between pt-2 border-t border-glass-border/50">
              <span className="text-[10px] text-white/40">
                Showing {(paymentsPage - 1) * PAYMENTS_PER_PAGE + 1} to{" "}
                {Math.min(
                  paymentsPage * PAYMENTS_PER_PAGE,
                  Math.min(paymentsData.length, MAX_PAYMENTS),
                )}{" "}
                of {Math.min(paymentsData.length, MAX_PAYMENTS)} recent payments
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                  disabled={paymentsPage === 1}
                  className="bg-white/5 hover:bg-white/10 text-white text-[10px] font-bold px-3 py-1.5 rounded disabled:opacity-30 transition"
                >
                  Prev
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({
                    length: Math.ceil(
                      Math.min(paymentsData.length, MAX_PAYMENTS) /
                        PAYMENTS_PER_PAGE,
                    ),
                  }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPaymentsPage(i + 1)}
                      className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono leading-none transition ${paymentsPage === i + 1 ? "bg-accent/20 text-accent border border-accent/30 font-bold" : "bg-white/5 text-white/50 hover:bg-white/10"}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() =>
                    setPaymentsPage((p) =>
                      Math.min(
                        Math.ceil(
                          Math.min(paymentsData.length, MAX_PAYMENTS) /
                            PAYMENTS_PER_PAGE,
                        ),
                        p + 1,
                      ),
                    )
                  }
                  disabled={
                    paymentsPage ===
                    Math.ceil(
                      Math.min(paymentsData.length, MAX_PAYMENTS) /
                        PAYMENTS_PER_PAGE,
                    )
                  }
                  className="bg-white/5 hover:bg-white/10 text-white text-[10px] font-bold px-3 py-1.5 rounded disabled:opacity-30 transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
