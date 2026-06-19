import { formatCurrency } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getBranchesForCurrentBusiness } from "../branches/branches-service.js";
import {
    getGeneralLedgerStatement,
    getGeneralLedgerBranchComparison,
    getJournalEntryDetailsByReference,
    getJournalEntryDetails,
    searchLedgerAccountsByName
} from "../general-ledger-report/general-ledger-report-service.js";
import { getReportsSummary, getTransactionSummaryReport, getTrialBalanceReport } from "./reports-service.js";
import { ROLES } from "../../core/roles.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { getActiveBranchDetails } from "../../core/data-access.js";

function escapeCsvValue(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
}

function toCsv(rows) {
    return rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
}

function downloadExcelCompatibleCsv(fileName, csvText) {
    const blob = new Blob([`\ufeff${csvText}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function downloadStyledExcelWorkbook(fileName, workbookXml) {
    const blob = new Blob([workbookXml], { type: "application/xml;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeXml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&apos;");
}

function exportReportsExcel(role, summary) {
    const now = new Date();
    const timestamp = now.toISOString();
    const rows = [
        ["Report", "Value"],
        ["Role", role || "unknown"],
        ["Generated At", timestamp],
        ["Revenue", summary.revenue],
        ["Cost Base", summary.costBase],
        ["Operating Profit", summary.profit],
        ["Expected Inflows", summary.inflows],
        ["Expected Outflows", summary.outflows],
        ["Trial Balance", summary.trialBalance],
        ["Tax Summary", summary.taxSummary],
        ["Close Status", summary.closeStatus]
    ];

    const csv = toCsv(rows);
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    downloadExcelCompatibleCsv(`tia-reports-${stamp}.csv`, csv);
}

function exportGlStatementExcel(statement) {
    if (!statement) {
        return;
    }

    const rows = [
        ["General Ledger Statement", `${statement.account.code} - ${statement.account.name}`],
        ["Date Range", `${statement.from} to ${statement.to}`],
        ["Opening Balance", statement.openingBalance],
        ["Total Debit", statement.totalDebit],
        ["Total Credit", statement.totalCredit],
        ["Closing Balance", statement.closingBalance],
        [],
        ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
        ...statement.lines.map((line) => [
            line.date,
            line.reference,
            line.description || line.memo,
            line.debit,
            line.credit,
            line.balance
        ])
    ];

    const csv = toCsv(rows);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const code = String(statement.account?.code || "account").replace(/[^A-Za-z0-9_-]/g, "_");
    downloadExcelCompatibleCsv(`gl-statement-${code}-${stamp}.csv`, csv);
}

function exportOperationTransactionSummaryExcel(rows = [], details = {}) {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const headerRows = [
        ["Transaction Summary", "Operations"],
        ["Date Range", `${details.dateFrom || "-"} to ${details.dateTo || "-"}`],
        ["Branch", details.branchName || "Active Branch"],
        ["Generated At", now.toISOString()],
        []
    ];
    const dataRows = [
        ["Group", "Date", "Reference", "GL Code", "GL Name", "Description", "Type", "Amount"],
        ...rows.map((row) => [
            getTransactionGroupLabel(row.sourceType),
            row.date || "",
            row.reference || "",
            row.glCode || "",
            row.glName || "",
            row.description || "",
            row.type || "",
            Number(row.amount || 0)
        ])
    ];
    downloadExcelCompatibleCsv(`transaction-summary-${stamp}.csv`, toCsv([...headerRows, ...dataRows]));
}

function exportTrialBalanceExcel(statement) {
    if (!statement) {
        return;
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const scopeLabel = String(statement.scopeLabel || "Business Workspace").trim() || "Business Workspace";
    const rows = [];
    const pushRow = (cells = []) => rows.push(`<Row>${cells.join("")}</Row>`);
    const cell = (value, styleId = "Cell", type = "String", mergeAcross = 0) => {
        const mergeAttr = mergeAcross > 0 ? ` ss:MergeAcross="${mergeAcross}"` : "";
        return `<Cell ss:StyleID="${styleId}"${mergeAttr}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
    };

    pushRow([cell(scopeLabel, "HeroBusiness", "String", 6)]);
    pushRow([cell("Trial Balance Statement", "HeroTitle", "String", 6)]);
    pushRow([cell(`${statement.dateFrom || "-"} to ${statement.dateTo || "-"}`, "HeroSub", "String", 6)]);
    pushRow([]);
    pushRow([
        cell("Business", "SummaryLabel"),
        cell(scopeLabel, "SummaryValue"),
        cell("Balanced", "SummaryLabel"),
        cell(statement.isBalanced ? "Yes" : "No", statement.isBalanced ? "SummaryBalanced" : "SummaryUnbalanced"),
        cell("Total Debit", "SummaryLabel"),
        cell(formatCurrency(statement.totals?.debit || 0), "SummaryDebit"),
        cell("Total Credit", "SummaryLabel"),
        cell(formatCurrency(statement.totals?.credit || 0), "SummaryCredit")
    ]);
    pushRow([]);
    pushRow([
        cell("Type", "Header"),
        cell("Category Code", "Header"),
        cell("Category Name", "Header"),
        cell("Account Code", "Header"),
        cell("Account Name", "Header"),
        cell("Debit", "Header"),
        cell("Credit", "Header")
    ]);

    for (const group of (statement.groups || [])) {
        pushRow([cell(group.label || "-", "GroupRow", "String", 6)]);
        for (const category of (group.categories || [])) {
            pushRow([cell(category.code ? `${category.code} - ${category.name}` : category.name || "-", "CategoryRow", "String", 6)]);
            for (const row of (category.rows || [])) {
                pushRow([
                    cell(group.label || "-", "Body"),
                    cell(category.code || "-", "Body"),
                    cell(category.name || "-", "Body"),
                    cell(row.code || "-", "Body"),
                    cell(row.name || "-", "Body"),
                    cell(row.debit > 0 ? formatCurrency(row.debit) : "-", "DebitCell"),
                    cell(row.credit > 0 ? formatCurrency(row.credit) : "-", "CreditCell")
                ]);
            }
            pushRow([
                cell(`${category.code ? `${category.code} - ${category.name}` : category.name || "-"} Total`, "SubtotalLabel", "String", 4),
                cell(formatCurrency(category.subtotal?.debit || 0), "SubtotalDebit"),
                cell(formatCurrency(category.subtotal?.credit || 0), "SubtotalCredit")
            ]);
        }
        pushRow([
            cell(`${group.label || "-"} Total`, "TypeTotalLabel", "String", 4),
            cell(formatCurrency(group.subtotal?.debit || 0), "TypeTotalDebit"),
            cell(formatCurrency(group.subtotal?.credit || 0), "TypeTotalCredit")
        ]);
        pushRow([]);
        pushRow([]);
    }

    pushRow([
        cell("Grand Total", "GrandTotalLabel", "String", 4),
        cell(formatCurrency(statement.totals?.debit || 0), "GrandTotalValue"),
        cell(formatCurrency(statement.totals?.credit || 0), "GrandTotalValue")
    ]);
    pushRow([]);
    pushRow([cell("Prepared from posted ledger activity and grouped by account type, category, and ledger account.", "Note", "String", 6)]);

    const workbookXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>OpenAI</Author>
  <Created>${escapeXml(new Date().toISOString())}</Created>
  <Company>${escapeXml(scopeLabel)}</Company>
 </DocumentProperties>
 <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">
  <ProtectStructure>False</ProtectStructure>
  <ProtectWindows>False</ProtectWindows>
 </ExcelWorkbook>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1B2B34"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="Cell">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1B2B34"/>
  </Style>
  <Style ss:ID="HeroBusiness">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#17313E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="HeroTitle">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="18" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#17313E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="HeroSub">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#D8E4EB"/>
   <Interior ss:Color="#17313E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="SummaryLabel">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#607080"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryValue">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#1B2B34"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryBalanced">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#166534"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryUnbalanced">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#9F1D1D"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryDebit">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#9F1D1D"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryCredit">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#166534"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#17313E"/>
   <Interior ss:Color="#DFE7EF" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
   </Borders>
  </Style>
  <Style ss:ID="Body">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1B2B34"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="DebitCell">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#9F1D1D"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="CreditCell">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#166534"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="GroupRow">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#17313E"/>
   <Interior ss:Color="#E5EBF1" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CategoryRow">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#5F4B32"/>
   <Interior ss:Color="#F3EFE7" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="SubtotalLabel">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#1B2B34"/>
   <Interior ss:Color="#F7F9FB" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="SubtotalDebit">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#9F1D1D"/>
   <Interior ss:Color="#F7F9FB" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="SubtotalCredit">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#166534"/>
   <Interior ss:Color="#F7F9FB" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFD8E3"/>
   </Borders>
  </Style>
  <Style ss:ID="TypeTotalLabel">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#17313E"/>
   <Interior ss:Color="#EDF3F7" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
   </Borders>
  </Style>
  <Style ss:ID="TypeTotalDebit">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#9F1D1D"/>
   <Interior ss:Color="#EDF3F7" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
   </Borders>
  </Style>
  <Style ss:ID="TypeTotalCredit">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#166534"/>
   <Interior ss:Color="#EDF3F7" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8C6D3"/>
   </Borders>
  </Style>
  <Style ss:ID="GrandTotalLabel">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#17313E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="GrandTotalValue">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#17313E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Note">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Italic="1" ss:Color="#607080"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Trial Balance">
  <Table>
   <Column ss:Width="110"/>
   <Column ss:Width="95"/>
   <Column ss:Width="140"/>
   <Column ss:Width="95"/>
   <Column ss:Width="190"/>
   <Column ss:Width="90"/>
   <Column ss:Width="90"/>
   ${rows.join("")}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <Zoom>80</Zoom>
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>7</SplitHorizontal>
   <TopRowBottomPane>7</TopRowBottomPane>
   <ActivePane>2</ActivePane>
   <Panes>
    <Pane>
     <Number>3</Number>
    </Pane>
    <Pane>
     <Number>2</Number>
    </Pane>
   </Panes>
   <ProtectObjects>False</ProtectObjects>
   <ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

    downloadStyledExcelWorkbook(`trial-balance-${stamp}.xml`, workbookXml);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
}

function formatDateOnly(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Africa/Lagos"
    }).format(date);
}

function formatDateTime(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Africa/Lagos"
    }).format(date);
}

async function getServerTodayIso() {
    return new Date().toISOString().slice(0, 10);
}

function getOneMonthBeforeIso(isoDate) {
    const base = new Date(`${String(isoDate || "").trim()}T00:00:00Z`);
    if (Number.isNaN(base.getTime())) {
        const fallback = new Date();
        fallback.setUTCMonth(fallback.getUTCMonth() - 1);
        return fallback.toISOString().slice(0, 10);
    }
    base.setUTCMonth(base.getUTCMonth() - 1);
    return base.toISOString().slice(0, 10);
}

function hideLoadingAfterPaint() {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                window.TIA_PAGE_LOADING?.hide?.();
                resolve();
            });
        });
    });
}

function formatBalanceWithSide(value) {
    const amount = Number(value || 0);
    const absValue = Math.abs(amount);
    if (Math.abs(amount) < 0.0000001) {
        return formatCurrency(0);
    }
    const side = amount < 0 ? "CR" : "DR";
    return `${formatCurrency(absValue)} ${side}`;
}

function getFilteredStatementLines(lines, filters = {}) {
    const refText = String(filters.reference || "").trim().toLowerCase();
    const descText = String(filters.description || "").trim().toLowerCase();
    const onlyDebit = Boolean(filters.onlyDebit);
    const onlyCredit = Boolean(filters.onlyCredit);

    return (lines || []).filter((line) => {
        const reference = String(line.reference || "").toLowerCase();
        const description = String(line.description || line.memo || "").toLowerCase();
        if (refText && !reference.includes(refText)) {
            return false;
        }
        if (descText && !description.includes(descText)) {
            return false;
        }
        if (onlyDebit && Number(line.debit || 0) <= 0) {
            return false;
        }
        if (onlyCredit && Number(line.credit || 0) <= 0) {
            return false;
        }
        return true;
    });
}

function paginateLines(lines, page = 1, pageSize = 25) {
    const safePageSize = Math.max(10, Math.min(Number(pageSize || 25), 100));
    const totalPages = Math.max(1, Math.ceil((lines.length || 0) / safePageSize));
    const safePage = Math.min(Math.max(Number(page || 1), 1), totalPages);
    const start = (safePage - 1) * safePageSize;
    const end = start + safePageSize;
    return {
        page: safePage,
        pageSize: safePageSize,
        totalPages,
        rows: lines.slice(start, end)
    };
}

function downloadStatementPdf(statement, options = {}) {
    if (!statement) {
        return;
    }
    const generatedBy = String(options.generatedBy || "System").trim();
    const generatedAt = formatDateTime(new Date().toISOString());

    const openingRow = `
        <tr>
            <td>${escapeHtml(statement.from || "-")}</td>
            <td>Opening</td>
            <td>Opening Balance</td>
            <td>-</td>
            <td>-</td>
            <td>${escapeHtml(formatBalanceWithSide(statement.openingBalance))}</td>
        </tr>
    `;

    const movementRows = (statement.lines || []).map((line) => `
        <tr>
            <td>${escapeHtml(formatDateOnly(line.date))}</td>
            <td>${escapeHtml(line.reference || "-")}</td>
            <td>${escapeHtml(line.description || line.memo || "-")}</td>
            <td>${escapeHtml(formatCurrency(line.debit))}</td>
            <td>${escapeHtml(formatCurrency(line.credit))}</td>
            <td>${escapeHtml(formatBalanceWithSide(line.balance))}</td>
        </tr>
    `).join("");

    const detailedHtml = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>GL Statement</title>
            <style>
                @page { size: A4; margin: 12mm; }
                body { font-family: Arial, sans-serif; padding: 20px; color: #222; }
                h2 { margin: 0 0 8px; }
                .meta { margin: 0 0 14px; font-size: 12px; color: #555; }
                .summary { margin: 0 0 14px; border: 1px solid #ddd; border-radius: 8px; padding: 10px; }
                .summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; font-size: 12px; }
                .summary-grid strong { font-size: 12px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
                th { background: #f5f5f5; }
                .footer { margin-top: 16px; font-size: 12px; color: #555; }
            </style>
        </head>
        <body>
            <h2>${escapeHtml(`${statement.account.code} - ${statement.account.name}`)}</h2>
            <p class="meta">${escapeHtml(statement.from)} to ${escapeHtml(statement.to)}</p>
            <section class="summary">
                <div class="summary-grid">
                    <div>Opening Balance: <strong>${escapeHtml(formatBalanceWithSide(statement.openingBalance))}</strong></div>
                    <div>Total Debit: <strong>${escapeHtml(formatCurrency(statement.totalDebit))}</strong></div>
                    <div>Total Credit: <strong>${escapeHtml(formatCurrency(statement.totalCredit))}</strong></div>
                    <div>Closing Balance: <strong>${escapeHtml(formatBalanceWithSide(statement.closingBalance))}</strong></div>
                </div>
            </section>
            <table>
                <thead>
                    <tr><th>Date</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>
                </thead>
                <tbody>${openingRow}${movementRows || '<tr><td colspan="6">No rows</td></tr>'}</tbody>
            </table>
            <p class="footer">Generated by: ${escapeHtml(generatedBy)} | Generated at: ${escapeHtml(generatedAt)}</p>
        </body>
        </html>
    `;
    const printHtml = detailedHtml;

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.visibility = "hidden";
    document.body.appendChild(frame);

    const cleanup = () => {
        try {
            frame.remove();
        } catch {
            // no-op
        }
    };

    if (!frame.contentWindow) {
        cleanup();
        showToast("Unable to open PDF print preview.");
        return;
    }

    frame.onload = () => {
        window.setTimeout(() => {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch {
                showToast("Unable to start print dialog.");
            } finally {
                window.setTimeout(cleanup, 3000);
            }
        }, 300);
    };
    frame.srcdoc = printHtml;
    window.setTimeout(cleanup, 60000);
}

function downloadOperationTransactionSummaryPdf(rows = [], details = {}, options = {}) {
    const generatedBy = String(options.generatedBy || "System").trim();
    const generatedAt = formatDateTime(new Date().toISOString());
    const totalDr = (rows || []).reduce((sum, row) => sum + (String(row.type || "").toUpperCase() === "DR" ? Number(row.amount || 0) : 0), 0);
    const totalCr = (rows || []).reduce((sum, row) => sum + (String(row.type || "").toUpperCase() === "CR" ? Number(row.amount || 0) : 0), 0);
    const grouped = rows.reduce((acc, row) => {
        const key = getTransactionGroupLabel(row.sourceType);
        if (!acc.has(key)) {
            acc.set(key, []);
        }
        acc.get(key).push(row);
        return acc;
    }, new Map());

    const groupSections = Array.from(grouped.entries()).map(([groupName, groupRows]) => `
        <section class="group-section">
        <h3>${escapeHtml(groupName)} <span class="group-count">${groupRows.length} lines</span></h3>
        <table class="txn-table">
            <colgroup>
                <col style="width: 10%">
                <col style="width: 16%">
                <col style="width: 11%">
                <col style="width: 9%">
                <col style="width: 12%">
                <col style="width: 24%">
                <col style="width: 6%">
                <col style="width: 12%">
            </colgroup>
            <thead>
                <tr>
                    <th class="nowrap-col">Date</th><th class="nowrap-col">Reference</th><th class="nowrap-col">Branch</th><th>GL Code</th><th>GL Name</th><th>Description</th><th>Type</th><th class="nowrap-col">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${groupRows.map((row) => `
                    <tr>
                        <td class="nowrap-col">${escapeHtml(formatDateOnly(row.date))}</td>
                        <td class="nowrap-col">${escapeHtml(row.reference || "-")}</td>
                        <td class="nowrap-col">${escapeHtml(details.branchName || "Active Branch")}</td>
                        <td>${escapeHtml(row.glCode || "-")}</td>
                        <td>${escapeHtml(row.glName || "-")}</td>
                        <td>${escapeHtml(row.description || "-")}</td>
                        <td><span class="type-chip ${String(row.type || "").toUpperCase() === "DR" ? "dr" : "cr"}">${escapeHtml(row.type || "-")}</span></td>
                        <td class="nowrap-col amount-cell ${String(row.type || "").toUpperCase() === "DR" ? "dr" : "cr"}">${escapeHtml(formatCurrency(row.amount))}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
        </section>
    `).join("");

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>Transaction Summary</title>
            <style>
                @page { size: A4 landscape; margin: 10mm; }
                :root {
                    --ink: #112031;
                    --muted: #5b6774;
                    --border: #d6deea;
                    --surface: #f7f9fc;
                    --headerA: #0f3d6e;
                    --headerB: #1a659e;
                    --dr-bg: #fde8e8;
                    --dr-fg: #9b1c1c;
                    --cr-bg: #def7ec;
                    --cr-fg: #03543f;
                    --amount-dr: #b42318;
                    --amount-cr: #027a48;
                }
                * {
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                body { font-family: "Segoe UI", Arial, sans-serif; padding: 0; color: var(--ink); background: #fff; }
                .page { padding: 16px; }
                .hero {
                    color: var(--ink);
                    border: 2px solid #174c7a;
                    border-radius: 12px;
                    padding: 12px 14px;
                    margin-bottom: 12px;
                    position: relative;
                }
                .hero::before {
                    content: "";
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    width: 8px;
                    background: #174c7a;
                    border-radius: 10px 0 0 10px;
                }
                .hero h2 { margin: 0; font-size: 20px; letter-spacing: 0.2px; }
                .hero .meta { margin-top: 4px; font-size: 12px; color: #355070; }
                .hero-mark {
                    margin-bottom: 6px;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 10px;
                    color: #174c7a;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.35px;
                }
                .hero-mark svg { display: block; }
                .summary-cards {
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 8px;
                    margin: 10px 0 14px;
                }
                .card {
                    border: 1px solid var(--border);
                    background: #fff;
                    border-radius: 10px;
                    padding: 9px 10px;
                    min-height: 52px;
                    border-left: 4px solid #9bb6d6;
                }
                .card .label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px; }
                .card .value { margin-top: 4px; font-size: 13px; font-weight: 700; color: var(--ink); }
                .card .value.dr { color: var(--amount-dr); }
                .card .value.cr { color: var(--amount-cr); }
                .card--branch { border-left-color: #285a8e; }
                .card--lines { border-left-color: #607d9d; }
                .card--dr { border-left-color: #b42318; }
                .card--cr { border-left-color: #027a48; }
                .group-section { margin-bottom: 12px; }
                h3 {
                    margin: 0 0 6px;
                    font-size: 13px;
                    color: #0f3d6e;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .group-count {
                    display: inline-block;
                    font-size: 10px;
                    font-weight: 600;
                    color: #355070;
                    background: #e9eef7;
                    border: 1px solid #cdd9ea;
                    border-radius: 999px;
                    padding: 2px 8px;
                }
                .txn-table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
                .txn-table th, .txn-table td { border: 1px solid var(--border); padding: 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
                .txn-table th { color: #12395b; font-weight: 700; border-top: 2px solid #2b5f92; }
                .txn-table tbody tr:nth-child(even) td { background: #fdfefe; }
                .nowrap-col { white-space: nowrap; }
                .type-chip {
                    display: inline-block;
                    min-width: 24px;
                    text-align: center;
                    font-size: 10px;
                    font-weight: 700;
                    border-radius: 999px;
                    padding: 1px 6px;
                }
                .type-chip.dr { background: var(--dr-bg); color: var(--dr-fg); }
                .type-chip.cr { background: var(--cr-bg); color: var(--cr-fg); }
                .amount-cell.dr { color: var(--amount-dr); font-weight: 700; }
                .amount-cell.cr { color: var(--amount-cr); font-weight: 700; }
                .footer {
                    margin-top: 12px;
                    padding-top: 8px;
                    border-top: 1px dashed #cdd9ea;
                    font-size: 11px;
                    color: #54637a;
                    display: flex;
                    justify-content: space-between;
                }
            </style>
        </head>
        <body>
            <div class="page">
                <header class="hero">
                    <div class="hero-mark">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                            <circle cx="8" cy="8" r="7" fill="none" stroke="#174c7a" stroke-width="2"></circle>
                            <path d="M4 8h8M8 4v8" stroke="#174c7a" stroke-width="1.5"></path>
                        </svg>
                        TIA Financial Report
                    </div>
                    <h2>Operations Transaction Summary</h2>
                    <div class="meta">${escapeHtml(details.dateFrom || "-")} to ${escapeHtml(details.dateTo || "-")}</div>
                </header>
                <section class="summary-cards">
                    <article class="card card--branch"><div class="label">Branch</div><div class="value">${escapeHtml(details.branchName || "Active Branch")}</div></article>
                    <article class="card card--lines"><div class="label">Total Lines</div><div class="value">${escapeHtml(rows.length)}</div></article>
                    <article class="card card--dr"><div class="label">Total Debit</div><div class="value dr">${escapeHtml(formatCurrency(totalDr))}</div></article>
                    <article class="card card--cr"><div class="label">Total Credit</div><div class="value cr">${escapeHtml(formatCurrency(totalCr))}</div></article>
                </section>
                ${groupSections || "<p style='color:#64748b;'>No transactions found.</p>"}
                <footer class="footer">
                    <span>Generated by: ${escapeHtml(generatedBy)}</span>
                    <span>Generated at: ${escapeHtml(generatedAt)}</span>
                </footer>
            </div>
        </body>
        </html>
    `;

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.visibility = "hidden";
    document.body.appendChild(frame);

    const cleanup = () => {
        try {
            frame.remove();
        } catch {
            // no-op
        }
    };

    if (!frame.contentWindow) {
        cleanup();
        showToast("Unable to open PDF print preview.");
        return;
    }

    frame.onload = () => {
        window.setTimeout(() => {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch {
                showToast("Unable to start print dialog.");
            } finally {
                window.setTimeout(cleanup, 3000);
            }
        }, 300);
    };
    frame.srcdoc = html;
    window.setTimeout(cleanup, 60000);
}

function downloadTrialBalancePdf(statement, options = {}) {
    if (!statement) {
        return;
    }

    const generatedBy = String(options.generatedBy || "System").trim();
    const generatedAt = formatDateTime(new Date().toISOString());
    const scopeLabel = String(statement.scopeLabel || "Head Office").trim() || "Head Office";
    const scopeTone = String(scopeLabel).toLowerCase().includes("head office")
        ? "head"
        : "branch";
    const rowsHtml = (statement.groups || []).map((group) => `
        <tr class="group-row">
            <td colspan="4">${escapeHtml(group.label || "-")}</td>
        </tr>
        ${(group.categories || []).map((category) => `
            <tr class="category-row">
                <td colspan="4">${escapeHtml(category.code ? `${category.code} - ${category.name}` : category.name || "-")}</td>
            </tr>
            ${(category.rows || []).map((row) => `
                <tr>
                    <td>${escapeHtml(row.code || "-")}</td>
                    <td>${escapeHtml(row.name || "-")}</td>
                    <td class="amount-dr">${escapeHtml(row.debit > 0 ? formatCurrency(row.debit) : "-")}</td>
                    <td class="amount-cr">${escapeHtml(row.credit > 0 ? formatCurrency(row.credit) : "-")}</td>
                </tr>
            `).join("")}
            <tr class="subtotal-row">
                <td colspan="2">${escapeHtml(category.code ? `${category.code} - ${category.name}` : category.name || "-")} Total</td>
                <td class="amount-dr">${escapeHtml(formatCurrency(category.subtotal?.debit || 0))}</td>
                <td class="amount-cr">${escapeHtml(formatCurrency(category.subtotal?.credit || 0))}</td>
            </tr>
        `).join("")}
        <tr class="subtotal-row">
            <td colspan="2">${escapeHtml(group.label || "-")} Total</td>
            <td class="amount-dr">${escapeHtml(formatCurrency(group.subtotal?.debit || 0))}</td>
            <td class="amount-cr">${escapeHtml(formatCurrency(group.subtotal?.credit || 0))}</td>
        </tr>
    `).join("");

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>Trial Balance Statement</title>
            <style>
                @page { size: A4 portrait; margin: 12mm; }
                :root {
                    --ink: #163040;
                    --muted: #5f7382;
                    --paper: #ffffff;
                    --surface: #f6f8fb;
                    --line: #d8e1ea;
                    --navy: #17313e;
                    --teal: #1f6f78;
                    --sand: #f5ede3;
                    --head-bg: #eef8f4;
                    --head-fg: #15624d;
                    --all-bg: #eef3fb;
                    --all-fg: #24507a;
                    --branch-bg: #fff3e8;
                    --branch-fg: #9a4f18;
                    --debit: #b42318;
                    --credit: #047857;
                }
                * {
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                body {
                    font-family: "Segoe UI", Arial, sans-serif;
                    padding: 0;
                    margin: 0;
                    color: var(--ink);
                    background: var(--paper);
                }
                .page {
                    padding: 18px;
                }
                .hero {
                    background: linear-gradient(135deg, var(--navy), var(--teal));
                    color: #fff;
                    border-radius: 18px;
                    padding: 18px 20px;
                    margin-bottom: 14px;
                    position: relative;
                    overflow: hidden;
                }
                .hero::after {
                    content: "";
                    position: absolute;
                    right: -40px;
                    top: -30px;
                    width: 160px;
                    height: 160px;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.08);
                }
                .hero h2 {
                    margin: 0;
                    font-size: 24px;
                    line-height: 1.15;
                }
                .hero .meta {
                    margin: 8px 0 0;
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.86);
                }
                .hero-grid {
                    display: grid;
                    grid-template-columns: 1.5fr 1fr;
                    gap: 16px;
                    align-items: end;
                }
                .scope-chip {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 8px 12px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 800;
                    background: rgba(255, 255, 255, 0.14);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                }
                .summary-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 10px;
                    margin: 0 0 14px;
                }
                .summary-card {
                    border: 1px solid var(--line);
                    border-radius: 14px;
                    padding: 12px 13px;
                    background: var(--surface);
                }
                .summary-card .label {
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: 0.14em;
                    text-transform: uppercase;
                    color: var(--muted);
                }
                .summary-card .value {
                    display: block;
                    margin-top: 6px;
                    font-size: 15px;
                    font-weight: 800;
                }
                .summary-card .value.debit { color: var(--debit); }
                .summary-card .value.credit { color: var(--credit); }
                .summary-card .value.balanced { color: var(--credit); }
                .summary-card .value.unbalanced { color: var(--debit); }
                table { width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid var(--line); }
                th, td { border: 1px solid var(--line); padding: 7px 8px; text-align: left; vertical-align: top; }
                th {
                    background: #eaf1f6;
                    color: var(--ink);
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }
                .group-row td {
                    background: #dfeaf1;
                    color: var(--navy);
                    font-weight: 800;
                }
                .category-row td {
                    background: var(--sand);
                    color: #7a4a28;
                    font-weight: 800;
                }
                .subtotal-row td {
                    background: #f8fafc;
                    font-weight: 800;
                }
                .grand-total-row td {
                    background: #edf7f2;
                    font-weight: 800;
                }
                .amount-dr, .amount-cr { text-align: right; }
                .amount-dr { color: var(--debit); }
                .amount-cr { color: var(--credit); }
                .footer {
                    margin-top: 14px;
                    font-size: 11px;
                    color: var(--muted);
                    display: flex;
                    justify-content: space-between;
                    gap: 10px;
                }
            </style>
        </head>
        <body>
            <div class="page">
                <section class="hero">
                    <div class="hero-grid">
                        <div>
                            <div class="scope-chip">${escapeHtml(scopeLabel)}</div>
                            <h2>Trial Balance Statement</h2>
                            <p class="meta">${escapeHtml(statement.dateFrom || "-")} to ${escapeHtml(statement.dateTo || "-")}</p>
                        </div>
                    </div>
                </section>

                <section class="summary-grid">
                    <article class="summary-card">
                        <span class="label">Balanced</span>
                        <span class="value ${statement.isBalanced ? "balanced" : "unbalanced"}">${escapeHtml(statement.isBalanced ? "Yes" : "No")}</span>
                    </article>
                    <article class="summary-card">
                        <span class="label">Total Debit</span>
                        <span class="value debit">${escapeHtml(formatCurrency(statement.totals?.debit || 0))}</span>
                    </article>
                    <article class="summary-card">
                        <span class="label">Total Credit</span>
                        <span class="value credit">${escapeHtml(formatCurrency(statement.totals?.credit || 0))}</span>
                    </article>
                </section>

                <table>
                    <thead>
                        <tr><th>Account Code</th><th>Account Name</th><th>Debit</th><th>Credit</th></tr>
                    </thead>
                    <tbody>
                        ${rowsHtml || '<tr><td colspan="4">No rows</td></tr>'}
                        <tr class="grand-total-row">
                            <td colspan="2">Grand Total</td>
                            <td class="amount-dr">${escapeHtml(formatCurrency(statement.totals?.debit || 0))}</td>
                            <td class="amount-cr">${escapeHtml(formatCurrency(statement.totals?.credit || 0))}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="footer">
                    <span>Generated by: ${escapeHtml(generatedBy)}</span>
                    <span>Generated at: ${escapeHtml(generatedAt)}</span>
                </div>
            </div>
        </body>
        </html>
    `;

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.visibility = "hidden";
    document.body.appendChild(frame);

    const cleanup = () => {
        try {
            frame.remove();
        } catch {
            // no-op
        }
    };

    if (!frame.contentWindow) {
        cleanup();
        showToast("Unable to open PDF print preview.");
        return;
    }

    frame.onload = () => {
        window.setTimeout(() => {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch {
                showToast("Unable to start print dialog.");
            } finally {
                window.setTimeout(cleanup, 3000);
            }
        }, 300);
    };
    frame.srcdoc = html;
    window.setTimeout(cleanup, 60000);
}

function renderGlStatement(statement, viewState = {}) {
    if (!statement) {
        return "";
    }

    const filtered = getFilteredStatementLines(statement.lines || [], viewState.filters || {});
    const paging = paginateLines(filtered, viewState.page || 1, viewState.pageSize || 25);
    const currentPage = paging.page;
    const totalPages = paging.totalPages;
    const visibleLines = paging.rows;
    const isAccountRole = Boolean(viewState.isAccountRole);

    return `
        <section class="panel">
            <div class="module-header">
                <div>
                    <p class="eyebrow">General Ledger Statement</p>
                    <h3>${statement.account.code} - ${statement.account.name}</h3>
                </div>
                <div class="button-row">
                    <button class="btn btn-secondary" type="button" data-export-gl-excel>Export Excel</button>
                    <button class="btn btn-secondary" type="button" data-export-gl-pdf>Export PDF</button>
                </div>
            </div>
            <div class="gl-summary-grid mt-18">
                <article class="gl-summary-card"><span>Opening Balance</span><strong class="amount-balance"><button class="text-btn gl-ref-btn" type="button" data-gl-balance-drill="opening">${formatBalanceWithSide(statement.openingBalance)}</button></strong></article>
                <article class="gl-summary-card"><span>Total Debit</span><strong class="amount-debit">${formatCurrency(statement.totalDebit)}</strong></article>
                <article class="gl-summary-card"><span>Total Credit</span><strong class="amount-credit">${formatCurrency(statement.totalCredit)}</strong></article>
                <article class="gl-summary-card"><span>Closing Balance</span><strong class="amount-balance"><button class="text-btn gl-ref-btn" type="button" data-gl-balance-drill="closing">${formatBalanceWithSide(statement.closingBalance)}</button></strong></article>
            </div>
            <div class="gl-filter-row mt-18">
                <label class="form-field">
                    <span>Reference Filter</span>
                    <input type="search" value="${escapeHtml(viewState.filters?.reference || "")}" data-gl-filter-reference placeholder="e.g. JV-2026">
                </label>
                <label class="form-field">
                    <span>Description Filter</span>
                    <input type="search" value="${escapeHtml(viewState.filters?.description || "")}" data-gl-filter-description placeholder="e.g. payroll">
                </label>
                <label class="form-check"><input type="checkbox" data-gl-filter-debit ${viewState.filters?.onlyDebit ? "checked" : ""}><span>Debit only</span></label>
                <label class="form-check"><input type="checkbox" data-gl-filter-credit ${viewState.filters?.onlyCredit ? "checked" : ""}><span>Credit only</span></label>
            </div>
            <div class="mt-18 table-wrap">
                <table class="gl-transaction-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Reference</th>
                            <th>Description</th>
                            <th class="amount-debit">Debit</th>
                            <th class="amount-credit">Credit</th>
                            <th class="amount-balance">Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>${formatDateOnly(statement.from)}</td>
                            <td>Opening</td>
                            <td>Opening Balance</td>
                            <td>-</td>
                            <td>-</td>
                            <td><span class="${Number(statement.openingBalance || 0) < 0 ? "amount-debit" : "amount-balance"}">${formatBalanceWithSide(statement.openingBalance)}</span></td>
                        </tr>
                        ${visibleLines.length
                            ? visibleLines.map((line) => `
                                <tr>
                                    <td>${formatDateOnly(line.date)}</td>
                                    <td>
                                        ${line.entryId
                                            ? `<button class="text-btn gl-ref-btn" type="button" data-gl-entry-open data-entry-id="${escapeHtml(line.entryId)}">${escapeHtml(line.reference || "-")}</button>`
                                            : escapeHtml(line.reference || "-")
                                        }
                                    </td>
                                    <td>${escapeHtml(line.description || line.memo || "-")}</td>
                                    <td><span class="amount-debit">${formatCurrency(line.debit)}</span></td>
                                    <td><span class="amount-credit">${formatCurrency(line.credit)}</span></td>
                                    <td><span class="${Number(line.balance || 0) < 0 ? "amount-debit" : "amount-balance"}">${formatBalanceWithSide(line.balance)}</span></td>
                                </tr>
                            `).join("")
                            : `<tr><td colspan="6">No debit or credit movement for this period.</td></tr>`
                        }
                    </tbody>
                </table>
            </div>
            <div class="button-row mt-18 gl-pager-row">
                <button class="btn btn-secondary" type="button" data-gl-page-prev ${currentPage <= 1 ? "disabled" : ""}>Prev</button>
                <p class="muted">Page ${currentPage} of ${totalPages}</p>
                <button class="btn btn-secondary" type="button" data-gl-page-next ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
            </div>
        </section>
    `;
}

function renderJournalEntryDetails(entry) {
    if (!entry) {
        return `<p class="muted">No transaction details available.</p>`;
    }

    return `
        <div class="gl-summary-grid">
            <article class="gl-summary-card"><span>Reference</span><strong>${escapeHtml(entry.reference || "-")}</strong></article>
            <article class="gl-summary-card"><span>Description</span><strong>${escapeHtml(entry.description || "-")}</strong></article>
            <article class="gl-summary-card"><span>Posted By</span><strong>${escapeHtml(entry.postedByName || "-")}</strong></article>
            <article class="gl-summary-card"><span>Posting Date</span><strong>${formatDateOnly(entry.entryDate)}</strong></article>
            <article class="gl-summary-card"><span>Posted At</span><strong>${formatDateTime(entry.postedAt)}</strong></article>
            <article class="gl-summary-card"><span>Branch</span><strong>${escapeHtml(entry.branchName || "-")}</strong></article>
        </div>
        <div class="mt-18 table-wrap">
            <table class="gl-transaction-table">
                <thead>
                    <tr>
                        <th>Account</th>
                        <th>Description</th>
                        <th class="amount-debit">Debit</th>
                        <th class="amount-credit">Credit</th>
                    </tr>
                </thead>
                <tbody>
                    ${(entry.lines || []).length
                        ? entry.lines.map((line) => `
                            <tr>
                                <td>${escapeHtml(`${line.accountCode} - ${line.accountName}`)}</td>
                                <td>${escapeHtml(line.description || "-")}</td>
                                <td><span class="amount-debit">${formatCurrency(line.debit)}</span></td>
                                <td><span class="amount-credit">${formatCurrency(line.credit)}</span></td>
                            </tr>
                        `).join("")
                        : `<tr><td colspan="4">No journal lines available.</td></tr>`
                    }
                </tbody>
            </table>
        </div>
    `;
}

function renderBranchComparisonTable(rows = []) {
    return `
        <section class="panel mt-18">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Account Role Only</p>
                    <h3>Branch Comparison</h3>
                </div>
            </div>
            <div class="table-wrap">
                <table class="gl-transaction-table">
                    <thead>
                        <tr>
                            <th>Branch</th>
                            <th class="amount-debit">Total Debit</th>
                            <th class="amount-credit">Total Credit</th>
                            <th class="amount-balance">Closing Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(rows || []).length
                            ? rows.map((row) => `
                                <tr>
                                    <td>${escapeHtml(row.branchName || "-")}</td>
                                    <td><span class="amount-debit">${formatCurrency(row.totalDebit)}</span></td>
                                    <td><span class="amount-credit">${formatCurrency(row.totalCredit)}</span></td>
                                    <td><span class="${Number(row.closingBalance || 0) < 0 ? "amount-debit" : "amount-balance"}">${formatBalanceWithSide(row.closingBalance)}</span></td>
                                </tr>
                            `).join("")
                            : `<tr><td colspan="4">No branch comparison data.</td></tr>`
                        }
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function renderTrialBalanceStatement(statement) {
    const groups = statement?.groups || [];
    const rowsHtml = groups.map((group) => `
        <tr class="trial-balance-group-row">
            <td colspan="7"><strong>${escapeHtml(group.label)}</strong></td>
        </tr>
        ${(group.categories || []).length
            ? (group.categories || []).map((category) => `
                <tr class="trial-balance-category-row">
                    <td colspan="7">${escapeHtml(category.code ? `${category.code} - ${category.name}` : category.name)}</td>
                </tr>
                ${(category.rows || []).map((row) => `
                    <tr>
                        <td>${escapeHtml(group.label || "-")}</td>
                        <td>${escapeHtml(category.code || "-")}</td>
                        <td>${escapeHtml(category.name || "-")}</td>
                        <td>${escapeHtml(row.code || "-")}</td>
                        <td>${escapeHtml(row.name || "-")}</td>
                        <td><span class="amount-debit">${row.debit > 0 ? formatCurrency(row.debit) : "-"}</span></td>
                        <td><span class="amount-credit">${row.credit > 0 ? formatCurrency(row.credit) : "-"}</span></td>
                    </tr>
                `).join("")}
                <tr class="trial-balance-subtotal-row">
                    <td colspan="5"><strong>${escapeHtml(category.code ? `${category.code} - ${category.name}` : category.name)} Total</strong></td>
                    <td><strong class="amount-debit">${formatCurrency(category.subtotal.debit)}</strong></td>
                    <td><strong class="amount-credit">${formatCurrency(category.subtotal.credit)}</strong></td>
                </tr>
            `).join("")
            : `<tr><td colspan="7">No GL created under ${escapeHtml(group.label)}.</td></tr>`
        }
        <tr class="trial-balance-subtotal-row">
            <td colspan="5"><strong>${escapeHtml(group.label)} Total</strong></td>
            <td><strong class="amount-debit">${formatCurrency(group.subtotal.debit)}</strong></td>
            <td><strong class="amount-credit">${formatCurrency(group.subtotal.credit)}</strong></td>
        </tr>
    `).join("");

    return `
        <section class="trial-balance-modal-view">
            <div class="trial-balance-modal-view__head">
                <div>
                    <h3>Trial Balance</h3>
                    <p>${escapeHtml(statement.dateFrom)} to ${escapeHtml(statement.dateTo)}</p>
                </div>
                <div class="trial-balance-modal-view__meta">
                    <span>${escapeHtml(statement.scopeLabel || "Business Workspace")}</span>
                    <span>${statement.isBalanced ? "Balanced" : "Not Balanced"}</span>
                    <span>Accounts: ${statement.rowCount || 0}</span>
                </div>
            </div>
            <div class="table-wrap">
                <table class="gl-transaction-table trial-balance-table trial-balance-table--detailed">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Category Code</th>
                            <th>Category</th>
                            <th>Account Code</th>
                            <th>Account Name</th>
                            <th class="amount-debit">Debit</th>
                            <th class="amount-credit">Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml || `<tr><td colspan="7">No trial balance movement for selected period.</td></tr>`}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5"><strong>Grand Total</strong></td>
                            <td><strong class="amount-debit">${formatCurrency(statement.totals?.debit || 0)}</strong></td>
                            <td><strong class="amount-credit">${formatCurrency(statement.totals?.credit || 0)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
    `;
}


function getTransactionGroupLabel(sourceType) {
    const value = String(sourceType || "").trim().toLowerCase();
    const labels = {
        manual_posting: "Journal Entries",
        reversal_posting: "Reversal",
        expense: "Expenses",
        expense_posting: "Expenses",
        invoice: "Invoices",
        invoice_posting: "Invoices",
        payroll: "Payroll",
        asset_posting: "Assets",
        depreciation: "Depreciation",
        amortization: "Amortization"
    };
    return labels[value] || "Other";
}

function renderOperationTransactionSummaryStatement(rows = [], details = {}) {
    const grouped = rows.reduce((acc, row) => {
        const key = getTransactionGroupLabel(row.sourceType);
        if (!acc.has(key)) {
            acc.set(key, []);
        }
        acc.get(key).push(row);
        return acc;
    }, new Map());

    const groupOrder = ["Journal Entries", "Expenses", "Reversal", "Invoices", "Payroll", "Assets", "Depreciation", "Amortization", "Other"];
    const orderedGroups = Array.from(grouped.entries()).sort((a, b) => {
        const aIndex = groupOrder.indexOf(a[0]);
        const bIndex = groupOrder.indexOf(b[0]);
        const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
        const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
        if (safeA !== safeB) {
            return safeA - safeB;
        }
        return String(a[0] || "").localeCompare(String(b[0] || ""));
    });

    const sectionsHtml = orderedGroups.map(([groupName, groupRows]) => `
        <section class="panel mt-18">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Transaction Group</p>
                    <h3>${escapeHtml(groupName)}</h3>
                </div>
            </div>
            <div class="table-wrap">
                <table class="gl-transaction-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Reference</th>
                            <th>GL Code</th>
                            <th>GL Name</th>
                            <th>Description</th>
                            <th>Type</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groupRows.map((row) => `
                            <tr>
                                <td>${escapeHtml(formatDateOnly(row.date))}</td>
                                <td>
                                    ${row.entryId
                                        ? `<button class="text-btn gl-ref-btn" type="button" data-op-entry-open data-entry-id="${escapeHtml(row.entryId || "")}" data-entry-reference="${escapeHtml(row.reference || "")}">${escapeHtml(row.reference || "-")}</button>`
                                        : `<span>${escapeHtml(row.reference || "-")}</span>`}
                                </td>
                                <td>${escapeHtml(row.glCode || "-")}</td>
                                <td>${escapeHtml(row.glName || "-")}</td>
                                <td>${escapeHtml(row.description || "-")}</td>
                                <td><span class="${row.type === "DR" ? "amount-debit" : "amount-credit"}">${escapeHtml(row.type || "-")}</span></td>
                                <td><span class="${row.type === "DR" ? "amount-debit" : "amount-credit"}">${formatCurrency(row.amount)}</span></td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </section>
    `).join("");

    return `
        <section class="panel">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Transaction Summary</p>
                    <h3>Operations Transaction Report</h3>
                </div>
                <div class="button-row">
                    <button class="btn btn-secondary" type="button" data-op-transaction-export-excel>Export Excel</button>
                    <button class="btn btn-secondary" type="button" data-op-transaction-export-pdf>Export PDF</button>
                    <span class="badge paid">${rows.length} lines</span>
                </div>
            </div>
            <div class="gl-summary-grid mt-18">
                <article class="gl-summary-card"><span>Date Range</span><strong>${escapeHtml(details.dateFrom || "-")} to ${escapeHtml(details.dateTo || "-")}</strong></article>
                <article class="gl-summary-card"><span>Branch</span><strong>${escapeHtml(details.branchName || "Active Branch")}</strong></article>
            </div>
        </section>
        ${rows.length ? sectionsHtml : `
            <section class="panel mt-18">
                <p class="muted">No transactions found for the selected date range.</p>
            </section>
        `}
    `;
}

export async function renderReports(role, context = {}) {
    const session = await getCurrentSessionContext();
    const normalizedRole = String(role || "").trim().toLowerCase();
    const isOperationsRole = normalizedRole === ROLES.STAFF;
    const isAccountRole = normalizedRole === ROLES.AUDITOR || normalizedRole === ROLES.ACCOUNT;
    const isBranchScopedRole = normalizedRole === ROLES.MANAGER || normalizedRole === ROLES.STAFF;
    const canOpenGlReport = isAccountRole || isBranchScopedRole;
    const canOpenTrialBalance = Boolean(session?.businessId) && (isAccountRole || isBranchScopedRole || normalizedRole === ROLES.BUSINESS_ADMIN);
    const scopeBranchRaw = String(context?.branchScope?.branchId || "").trim();
    const scopeBranchId = scopeBranchRaw && scopeBranchRaw !== "__all__" ? scopeBranchRaw : "";
    const summary = await getReportsSummary(role, { branchId: isAccountRole ? scopeBranchId : "" });
    const activeBranch = isBranchScopedRole
        ? await getActiveBranchDetails(session?.userId, session?.businessId)
        : null;
    const branches = canOpenTrialBalance ? await getBranchesForCurrentBusiness() : [];
    const fixedBranchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();
    const fixedBranchLabel = activeBranch?.canAccessAllBranches
        ? "Head Office"
        : String(activeBranch?.name || "Active Branch");
    const extra = isAccountRole
        ? `<div class="stack-item"><span>Access mode</span><strong>General ledger and financial reports</strong></div>`
        : isBranchScopedRole
            ? `<div class="stack-item"><span>Access mode</span><strong>Branch-limited reporting</strong></div>`
            : `<div class="stack-item"><span>Action</span><strong>Export board pack</strong></div>`;

    return {
        summary: [],
        content: `
            <div class="section-stack">
                <div class="module-header">
                    <div>
                        <p class="eyebrow">Financial insight</p>
                        <h2>Reports</h2>
                    </div>
                    <div class="button-row">
                        <button class="btn btn-secondary" type="button" data-export-excel>Export Excel</button>
                    </div>
                </div>

                ${canOpenGlReport ? `
                    ${isOperationsRole ? `
                        <section class="panel">
                            <div class="report-launch-grid">
                                <button class="report-launch-card" type="button" data-open-gl-report-modal>
                                    <span class="report-launch-card__eyebrow">Ledger</span>
                                    <strong>General Ledger Report</strong>
                                </button>
                                <button class="report-launch-card" type="button" data-open-op-transaction-modal>
                                    <span class="report-launch-card__eyebrow">Transactions</span>
                                    <strong>Transaction Summary</strong>
                                </button>
                            </div>
                        </section>
                    ` : `
                        <section class="panel">
                            <div class="report-launch-grid">
                                <button class="report-launch-card" type="button" data-open-gl-report-modal>
                                    <span class="report-launch-card__eyebrow">Ledger</span>
                                    <strong>General Ledger Report</strong>
                                </button>
                                ${canOpenTrialBalance ? `
                                    <button class="report-launch-card" type="button" data-open-trial-balance-modal>
                                        <span class="report-launch-card__eyebrow">Financial</span>
                                        <strong>Trial Balance</strong>
                                    </button>
                                ` : ""}
                            </div>
                        </section>
                    `}
                ` : ""}

                <div class="content-grid">
                    <section class="panel">
                        <h3>Profit &amp; Loss</h3>
                        <p class="muted mt-18">Revenue: <span data-reports-revenue>${summary.revenue}</span></p>
                        <p class="muted">Cost Base: <span data-reports-cost>${summary.costBase}</span></p>
                        <p class="muted">Operating Profit: <span data-reports-profit>${summary.profit}</span></p>
                        <div class="stack-list mt-18">
                            <div class="stack-item"><span>Trial Balance</span><strong data-reports-trial>${summary.trialBalance}</strong></div>
                            ${extra}
                        </div>
                    </section>
                    <section class="panel">
                        <h3>Cashflow Watch</h3>
                        <p class="muted mt-18">Expected inflows this month: <span data-reports-inflows>${summary.inflows}</span></p>
                        <p class="muted">Expected outflows this month: <span data-reports-outflows>${summary.outflows}</span></p>
                        <div class="stack-list mt-18">
                            <div class="stack-item"><span>Tax summary</span><strong data-reports-tax>${summary.taxSummary}</strong></div>
                            <div class="stack-item"><span>Close status</span><strong data-reports-close>${summary.closeStatus}</strong></div>
                        </div>
                    </section>
                </div>

                ${canOpenGlReport ? `
                    <div class="business-modal" data-gl-report-modal hidden>
                        <div class="business-modal__backdrop" data-gl-report-close></div>
                        <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="glReportTitle">
                            <div class="business-modal__head">
                                <div>
                                    <p class="eyebrow">Ledger statement</p>
                                    <h3 id="glReportTitle">General Ledger Report</h3>
                                </div>
                                <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-gl-report-close>&times;</button>
                            </div>
                            <form class="form-grid" data-gl-report-form>
                                <div class="triple-grid">
                                    <label class="form-field gl-search-field">
                                        <span>Search Ledger Name</span>
                                        <input name="search_name" type="text" autocomplete="off" list="glReportAccountList" placeholder="Type account code or name...">
                                        <input name="account_id" type="hidden">
                                    </label>
                                    <label class="form-field">
                                        <span>Date From</span>
                                        <input name="date_from" type="date" required>
                                    </label>
                                    <label class="form-field">
                                        <span>Date To</span>
                                        <input name="date_to" type="date" required>
                                    </label>
                                    <input name="branch_id" type="hidden" value="${isAccountRole ? scopeBranchId : fixedBranchId}">
                                </div>
                                <datalist id="glReportAccountList" data-gl-report-account-list></datalist>
                                <div class="button-row gl-period-presets">
                                    <button class="btn btn-secondary" type="button" data-gl-preset="today">Today</button>
                                    <button class="btn btn-secondary" type="button" data-gl-preset="thisMonth">This Month</button>
                                    <button class="btn btn-secondary" type="button" data-gl-preset="lastMonth">Last Month</button>
                                    <button class="btn btn-secondary" type="button" data-gl-preset="ytd">YTD</button>
                                </div>
                                <div class="button-row">
                                    <button class="btn btn-primary" type="submit" data-gl-report-view>
                                        <span class="btn-label">View Statement</span>
                                        <span class="spinner" aria-hidden="true"></span>
                                    </button>
                                    <p class="muted" data-gl-report-status>Type and pick a ledger from suggestion before viewing.</p>
                                </div>
                            </form>
                        </div>
                    </div>
                    <div class="business-modal" data-gl-statement-modal hidden>
                        <div class="business-modal__backdrop" data-gl-statement-close></div>
                        <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="glStatementTitle">
                            <div class="business-modal__head">
                                <div>
                                    <p class="eyebrow">Ledger statement</p>
                                    <h3 id="glStatementTitle">General Ledger Statement</h3>
                                </div>
                                <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-gl-statement-close>&times;</button>
                            </div>
                            <div class="gl-statement-modal__content" data-gl-statement-content>
                                <p class="muted">No statement loaded yet.</p>
                            </div>
                        </div>
                    </div>
                    <div class="business-modal" data-gl-entry-modal hidden>
                        <div class="business-modal__backdrop" data-gl-entry-close></div>
                        <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="glEntryTitle">
                            <div class="business-modal__head">
                                <div>
                                    <p class="eyebrow">Transaction Detail</p>
                                    <h3 id="glEntryTitle">Journal Entry</h3>
                                </div>
                                <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-gl-entry-close>&times;</button>
                            </div>
                            <div class="gl-statement-modal__content" data-gl-entry-content>
                                <p class="muted">No entry selected yet.</p>
                            </div>
                        </div>
                    </div>
                    ${isOperationsRole ? `
                        <div class="business-modal" data-op-transaction-picker-modal hidden>
                            <div class="business-modal__backdrop" data-op-transaction-picker-close></div>
                            <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="opTransactionPickerTitle">
                                <div class="business-modal__head">
                                    <div>
                                        <p class="eyebrow">Transactions</p>
                                        <h3 id="opTransactionPickerTitle">Transaction Summary Range</h3>
                                    </div>
                                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-op-transaction-picker-close>&times;</button>
                                </div>
                                <form class="form-grid" data-op-transaction-form>
                                    <div class="dual-grid">
                                        <label class="form-field">
                                            <span>Date From</span>
                                            <input name="date_from" type="date" required>
                                        </label>
                                        <label class="form-field">
                                            <span>Date To</span>
                                            <input name="date_to" type="date" required>
                                        </label>
                                    </div>
                                    <div class="button-row">
                                        <button class="btn btn-primary" type="submit" data-op-transaction-load>
                                            <span class="btn-label">View Summary</span>
                                            <span class="spinner" aria-hidden="true"></span>
                                        </button>
                                        <p class="muted" data-op-transaction-status>Pick date range and submit.</p>
                                    </div>
                                </form>
                            </div>
                        </div>
                        <div class="business-modal" data-op-transaction-statement-modal hidden>
                            <div class="business-modal__backdrop" data-op-transaction-statement-close></div>
                            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="opTransactionStatementTitle">
                                <div class="business-modal__head">
                                    <div>
                                        <p class="eyebrow">Transactions</p>
                                        <h3 id="opTransactionStatementTitle">Transaction Summary</h3>
                                    </div>
                                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-op-transaction-statement-close>&times;</button>
                                </div>
                                <div class="gl-statement-modal__content" data-op-transaction-statement-content>
                                    <p class="muted">No transaction summary loaded yet.</p>
                                </div>
                            </div>
                        </div>
                    ` : ""}
                    ${canOpenTrialBalance ? `
                        <div class="business-modal" data-trial-balance-modal hidden>
                            <div class="business-modal__backdrop" data-trial-balance-close></div>
                            <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="trialBalancePickerTitle">
                                <div class="business-modal__head">
                                    <div>
                                        <p class="eyebrow">Financial report</p>
                                        <h3 id="trialBalancePickerTitle">Trial Balance Date Range</h3>
                                    </div>
                                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-trial-balance-close>&times;</button>
                                </div>
                                <form class="form-grid" data-trial-balance-form>
                                    <div class="dual-grid">
                                        <label class="form-field">
                                            <span>Date From</span>
                                            <input name="date_from" type="date" required>
                                        </label>
                                        <label class="form-field">
                                            <span>Date To</span>
                                            <input name="date_to" type="date" required>
                                        </label>
                                    </div>
                                    <input name="branch_id" type="hidden" value="${isAccountRole ? scopeBranchId : fixedBranchId}">
                                    <div class="button-row">
                                        <button class="btn btn-primary" type="submit" data-trial-balance-view>
                                            <span class="btn-label">View Trial Balance</span>
                                            <span class="spinner" aria-hidden="true"></span>
                                        </button>
                                        <p class="muted" data-trial-balance-status>Pick date range and submit.</p>
                                    </div>
                                </form>
                            </div>
                        </div>
                        <div class="business-modal" data-trial-balance-statement-modal hidden>
                            <div class="business-modal__backdrop" data-trial-balance-statement-close></div>
                            <div class="business-modal__dialog trial-balance-result-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="trialBalanceStatementTitle">
                                <div class="business-modal__head">
                                    <div>
                                        <p class="eyebrow">Financial report</p>
                                        <h3 id="trialBalanceStatementTitle">Trial Balance Statement</h3>
                                    </div>
                                    <div class="button-row">
                                        <button class="btn btn-secondary" type="button" data-trial-balance-export-excel>Export Excel</button>
                                        <button class="btn btn-secondary" type="button" data-trial-balance-export-pdf>Export PDF</button>
                                        <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-trial-balance-statement-close>&times;</button>
                                    </div>
                                </div>
                                <div class="gl-statement-modal__content" data-trial-balance-statement-content>
                                    <p class="muted">No statement loaded yet.</p>
                                </div>
                            </div>
                        </div>
                    ` : ""}
                ` : ""}
            </div>
        `,
        afterRender(pageContent) {
            const resolveTrialBalanceScopeLabel = (branchId) => {
                const normalizedBranchId = String(branchId || "").trim();
                if (!normalizedBranchId) {
                    return activeBranch?.canAccessAllBranches
                        ? fixedBranchLabel
                        : String(session?.businessName || "Business Workspace");
                }

                const match = (branches || []).find((branch) => String(branch.id || "") === normalizedBranchId);
                if (!match) {
                    return normalizedBranchId === fixedBranchId
                        ? fixedBranchLabel
                        : "Selected Branch";
                }

                return match.isHeadOffice
                    ? "Head Office"
                    : String(match.name || "Selected Branch");
            };

            const writeSummary = (nextSummary) => {
                const setText = (selector, value) => {
                    const node = pageContent.querySelector(selector);
                    if (node) {
                        node.textContent = value;
                    }
                };

                setText("[data-reports-revenue]", nextSummary.revenue);
                setText("[data-reports-cost]", nextSummary.costBase);
                setText("[data-reports-profit]", nextSummary.profit);
                setText("[data-reports-trial]", nextSummary.trialBalance);
                setText("[data-reports-inflows]", nextSummary.inflows);
                setText("[data-reports-outflows]", nextSummary.outflows);
                setText("[data-reports-tax]", nextSummary.taxSummary);
                setText("[data-reports-close]", nextSummary.closeStatus);
            };

            const exportButton = pageContent.querySelector("[data-export-excel]");
            exportButton?.addEventListener("click", () => {
                window.TIA_PAGE_LOADING?.show?.();
                try {
                    const summaryForExport = {
                        revenue: pageContent.querySelector("[data-reports-revenue]")?.textContent || summary.revenue,
                        costBase: pageContent.querySelector("[data-reports-cost]")?.textContent || summary.costBase,
                        profit: pageContent.querySelector("[data-reports-profit]")?.textContent || summary.profit,
                        inflows: pageContent.querySelector("[data-reports-inflows]")?.textContent || summary.inflows,
                        outflows: pageContent.querySelector("[data-reports-outflows]")?.textContent || summary.outflows,
                        trialBalance: pageContent.querySelector("[data-reports-trial]")?.textContent || summary.trialBalance,
                        taxSummary: pageContent.querySelector("[data-reports-tax]")?.textContent || summary.taxSummary,
                        closeStatus: pageContent.querySelector("[data-reports-close]")?.textContent || summary.closeStatus
                    };
                    exportReportsExcel(role, summaryForExport);
                } finally {
                    window.setTimeout(() => window.TIA_PAGE_LOADING?.hide?.(), 300);
                }
            });

            if (!canOpenGlReport) {
                return;
            }

            const modal = pageContent.querySelector("[data-gl-report-modal]");
            const openButton = pageContent.querySelector("[data-open-gl-report-modal]");
            const form = pageContent.querySelector("[data-gl-report-form]");
            const searchInput = form?.querySelector('input[name="search_name"]');
            const accountIdInput = form?.querySelector('input[name="account_id"]');
            const accountList = form?.querySelector("[data-gl-report-account-list]");
            const dateFromInput = form?.querySelector('input[name="date_from"]');
            const dateToInput = form?.querySelector('input[name="date_to"]');
            const statusNode = form?.querySelector("[data-gl-report-status]");
            const viewButton = form?.querySelector("[data-gl-report-view]");
            const statementModal = pageContent.querySelector("[data-gl-statement-modal]");
            const statementContent = pageContent.querySelector("[data-gl-statement-content]");
            const entryModal = pageContent.querySelector("[data-gl-entry-modal]");
            const entryContent = pageContent.querySelector("[data-gl-entry-content]");
            const trialBalanceModal = pageContent.querySelector("[data-trial-balance-modal]");
            const trialBalanceForm = pageContent.querySelector("[data-trial-balance-form]");
            const trialBalanceStatusNode = pageContent.querySelector("[data-trial-balance-status]");
            const trialBalanceViewButton = pageContent.querySelector("[data-trial-balance-view]");
            const trialBalanceStatementModal = pageContent.querySelector("[data-trial-balance-statement-modal]");
            const trialBalanceStatementContent = pageContent.querySelector("[data-trial-balance-statement-content]");
            const trialBalanceOpenButton = pageContent.querySelector("[data-open-trial-balance-modal]");
            const opTransactionOpenButton = pageContent.querySelector("[data-open-op-transaction-modal]");
            const opTransactionPickerModal = pageContent.querySelector("[data-op-transaction-picker-modal]");
            const opTransactionStatementModal = pageContent.querySelector("[data-op-transaction-statement-modal]");
            const opTransactionForm = pageContent.querySelector("[data-op-transaction-form]");
            const opTransactionDateFrom = opTransactionForm?.querySelector('input[name="date_from"]');
            const opTransactionDateTo = opTransactionForm?.querySelector('input[name="date_to"]');
            const opTransactionLoadButton = pageContent.querySelector("[data-op-transaction-load]");
            const opTransactionStatus = pageContent.querySelector("[data-op-transaction-status]");
            const opTransactionStatementContent = pageContent.querySelector("[data-op-transaction-statement-content]");
            let opTransactionRows = [];
            let opTransactionDetails = {
                dateFrom: "",
                dateTo: "",
                branchName: fixedBranchLabel
            };
            let selectedTrialBalanceStatement = null;
            let selectedAccount = null;
            let selectedStatement = null;
            let returnToOpTransactionStatementAfterEntryClose = false;
            let searchTimer = null;
            let accountOptions = [];
            let filterRenderTimer = null;
            let lastFilterFocus = "";
            let statementViewState = {
                page: 1,
                pageSize: 25,
                filters: {
                    reference: "",
                    description: "",
                    onlyDebit: false,
                    onlyCredit: false
                }
            };

            const closeModal = () => {
                if (modal) {
                    modal.hidden = true;
                }
            };

            const openModal = () => {
                if (modal) {
                    modal.hidden = false;
                    searchInput?.focus();
                }
            };

            const openStatementModal = () => {
                if (statementModal) {
                    statementModal.hidden = false;
                }
            };

            const closeStatementModal = (returnToPicker = true) => {
                if (statementModal) {
                    statementModal.hidden = true;
                }
                if (returnToPicker) {
                    openModal();
                }
            };

            const openEntryModal = () => {
                if (entryModal) {
                    entryModal.hidden = false;
                }
            };

            const closeEntryModal = () => {
                if (entryModal) {
                    entryModal.hidden = true;
                }
                if (returnToOpTransactionStatementAfterEntryClose) {
                    returnToOpTransactionStatementAfterEntryClose = false;
                    openOpTransactionStatementModal();
                }
            };

            const closeTrialBalanceModal = () => {
                if (trialBalanceModal) {
                    trialBalanceModal.hidden = true;
                }
            };

            const openTrialBalanceModal = () => {
                if (trialBalanceModal) {
                    trialBalanceModal.hidden = false;
                }
            };

            const closeTrialBalanceStatementModal = () => {
                if (trialBalanceStatementModal) {
                    trialBalanceStatementModal.hidden = true;
                }
            };

            const openTrialBalanceStatementModal = () => {
                if (trialBalanceStatementModal) {
                    trialBalanceStatementModal.hidden = false;
                }
            };

            const setViewState = (isLoading) => {
                if (!viewButton) return;
                viewButton.disabled = isLoading;
                viewButton.classList.toggle("is-loading", isLoading);
                viewButton.setAttribute("aria-busy", String(isLoading));
            };

            const setTrialBalanceViewState = (isLoading) => {
                if (!trialBalanceViewButton) return;
                trialBalanceViewButton.disabled = isLoading;
                trialBalanceViewButton.classList.toggle("is-loading", isLoading);
                trialBalanceViewButton.setAttribute("aria-busy", String(isLoading));
            };

            const setOpTransactionViewState = (isLoading) => {
                if (!opTransactionLoadButton) return;
                opTransactionLoadButton.disabled = isLoading;
                opTransactionLoadButton.classList.toggle("is-loading", isLoading);
                opTransactionLoadButton.setAttribute("aria-busy", String(isLoading));
            };

            const openOpTransactionPickerModal = () => {
                if (opTransactionPickerModal) {
                    opTransactionPickerModal.hidden = false;
                }
            };

            const closeOpTransactionPickerModal = () => {
                if (opTransactionPickerModal) {
                    opTransactionPickerModal.hidden = true;
                }
            };

            const openOpTransactionStatementModal = () => {
                if (opTransactionStatementModal) {
                    opTransactionStatementModal.hidden = false;
                }
            };

            const closeOpTransactionStatementModal = () => {
                if (opTransactionStatementModal) {
                    opTransactionStatementModal.hidden = true;
                }
            };

            const bindOperationTransactionActions = () => {
                if (!opTransactionStatementContent) {
                    return;
                }
                opTransactionStatementContent
                    .querySelector("[data-op-transaction-export-excel]")
                    ?.addEventListener("click", () => {
                        exportOperationTransactionSummaryExcel(opTransactionRows, opTransactionDetails);
                        showToast("Transaction summary exported.");
                    });
                opTransactionStatementContent
                    .querySelector("[data-op-transaction-export-pdf]")
                    ?.addEventListener("click", () => {
                        downloadOperationTransactionSummaryPdf(opTransactionRows, opTransactionDetails, {
                            generatedBy: session?.fullName || session?.userEmail || "System User"
                        });
                    });
            };

            const bindTrialBalanceActions = () => {
                const exportExcelButton = trialBalanceStatementModal?.querySelector("[data-trial-balance-export-excel]");
                const exportPdfButton = trialBalanceStatementModal?.querySelector("[data-trial-balance-export-pdf]");
                if (exportExcelButton) {
                    exportExcelButton.onclick = () => {
                        exportTrialBalanceExcel(selectedTrialBalanceStatement);
                        showToast("Trial balance exported.");
                    };
                }
                if (exportPdfButton) {
                    exportPdfButton.onclick = () => {
                        downloadTrialBalancePdf(selectedTrialBalanceStatement, {
                            generatedBy: session?.fullName || session?.userEmail || "System User"
                        });
                    };
                }
            };

            opTransactionStatementContent?.addEventListener("click", async (event) => {
                const button = event.target?.closest?.("[data-op-entry-open]");
                if (!button || !opTransactionStatementContent.contains(button)) {
                    return;
                }
                const entryId = String(button.getAttribute("data-entry-id") || "").trim();
                const entryReference = String(button.getAttribute("data-entry-reference") || "").trim();
                if (!entryContent) {
                    return;
                }
                returnToOpTransactionStatementAfterEntryClose = true;
                closeOpTransactionStatementModal();
                entryContent.innerHTML = `<p class="muted">Loading transaction detail...</p>`;
                openEntryModal();
                window.TIA_PAGE_LOADING?.show?.();
                try {
                    const details = entryId
                        ? await getJournalEntryDetails(entryId)
                        : entryReference
                            ? await getJournalEntryDetailsByReference(entryReference)
                            : null;
                    if (!details) {
                        throw new Error("Detail is unavailable for this reference.");
                    }
                    entryContent.innerHTML = renderJournalEntryDetails(details);
                } catch (error) {
                    entryContent.innerHTML = `<p class="muted">${escapeHtml(error?.message || "Unable to load transaction detail.")}</p>`;
                } finally {
                    await hideLoadingAfterPaint();
                }
            });

            const bindStatementInteractions = () => {
                if (!statementContent || !selectedStatement) {
                    return;
                }

                statementContent.querySelector("[data-export-gl-excel]")?.addEventListener("click", () => {
                    exportGlStatementExcel(selectedStatement);
                    showToast("General ledger statement exported.");
                });

                statementContent.querySelector("[data-export-gl-pdf]")?.addEventListener("click", () => {
                    downloadStatementPdf(selectedStatement, {
                        generatedBy: session?.fullName || session?.userEmail || "System User"
                    });
                });

                statementContent.querySelector("[data-gl-filter-reference]")?.addEventListener("input", (event) => {
                    statementViewState.filters.reference = String(event.target?.value || "");
                    statementViewState.page = 1;
                    lastFilterFocus = "reference";
                    if (filterRenderTimer) {
                        window.clearTimeout(filterRenderTimer);
                    }
                    filterRenderTimer = window.setTimeout(() => {
                        renderStatementContent();
                    }, 200);
                });
                statementContent.querySelector("[data-gl-filter-description]")?.addEventListener("input", (event) => {
                    statementViewState.filters.description = String(event.target?.value || "");
                    statementViewState.page = 1;
                    lastFilterFocus = "description";
                    if (filterRenderTimer) {
                        window.clearTimeout(filterRenderTimer);
                    }
                    filterRenderTimer = window.setTimeout(() => {
                        renderStatementContent();
                    }, 200);
                });
                statementContent.querySelector("[data-gl-filter-debit]")?.addEventListener("change", (event) => {
                    statementViewState.filters.onlyDebit = Boolean(event.target?.checked);
                    statementViewState.page = 1;
                    renderStatementContent();
                });
                statementContent.querySelector("[data-gl-filter-credit]")?.addEventListener("change", (event) => {
                    statementViewState.filters.onlyCredit = Boolean(event.target?.checked);
                    statementViewState.page = 1;
                    renderStatementContent();
                });

                statementContent.querySelector("[data-gl-page-prev]")?.addEventListener("click", () => {
                    statementViewState.page = Math.max(1, Number(statementViewState.page || 1) - 1);
                    renderStatementContent();
                });
                statementContent.querySelector("[data-gl-page-next]")?.addEventListener("click", () => {
                    statementViewState.page = Number(statementViewState.page || 1) + 1;
                    renderStatementContent();
                });

                statementContent.querySelectorAll("[data-gl-balance-drill]").forEach((button) => {
                    button.addEventListener("click", () => {
                        const type = String(button.getAttribute("data-gl-balance-drill") || "");
                        const source = selectedStatement?.lines || [];
                        const subset = type === "opening" ? source.slice(0, 20) : source.slice(-20);
                        const drillEntry = {
                            reference: type === "opening" ? "Opening Balance Drilldown" : "Closing Balance Drilldown",
                            description: "Showing up to 20 related movements in current range.",
                            postedByName: "System",
                            entryDate: selectedStatement?.from,
                            postedAt: new Date().toISOString(),
                            branchName: selectedStatement?.branchName || "Head Office",
                            lines: subset.map((line) => ({
                                accountCode: selectedStatement?.account?.code || "-",
                                accountName: selectedStatement?.account?.name || "-",
                                description: line.description || line.memo || "-",
                                debit: line.debit,
                                credit: line.credit
                            }))
                        };
                        if (entryContent) {
                            entryContent.innerHTML = renderJournalEntryDetails(drillEntry);
                            openEntryModal();
                        }
                    });
                });

                statementContent.querySelectorAll("[data-gl-entry-open]").forEach((button) => {
                    button.addEventListener("click", async () => {
                        const entryId = String(button.getAttribute("data-entry-id") || "").trim();
                        if (!entryId || !entryContent) {
                            return;
                        }
                        entryContent.innerHTML = `<p class="muted">Loading transaction detail...</p>`;
                        openEntryModal();
                        window.TIA_PAGE_LOADING?.show?.();
                        try {
                            const details = await getJournalEntryDetails(entryId);
                            entryContent.innerHTML = renderJournalEntryDetails(details);
                        } catch (detailError) {
                            entryContent.innerHTML = `<p class="muted">${escapeHtml(detailError?.message || "Unable to load transaction detail.")}</p>`;
                        } finally {
                            await hideLoadingAfterPaint();
                        }
                    });
                });
            };

            const renderStatementContent = () => {
                if (!statementContent || !selectedStatement) {
                    return;
                }
                statementContent.innerHTML = renderGlStatement(selectedStatement, {
                    ...statementViewState,
                    isAccountRole
                });
                bindStatementInteractions();

                if (lastFilterFocus === "reference") {
                    const node = statementContent.querySelector("[data-gl-filter-reference]");
                    node?.focus();
                    const len = node?.value?.length || 0;
                    node?.setSelectionRange?.(len, len);
                } else if (lastFilterFocus === "description") {
                    const node = statementContent.querySelector("[data-gl-filter-description]");
                    node?.focus();
                    const len = node?.value?.length || 0;
                    node?.setSelectionRange?.(len, len);
                }
            };

            void getServerTodayIso().then((todayIso) => {
                if (dateToInput && !dateToInput.value) {
                    dateToInput.value = todayIso;
                }
                if (dateFromInput && !dateFromInput.value) {
                    dateFromInput.value = getOneMonthBeforeIso(todayIso);
                }
            });

            form?.querySelectorAll("[data-gl-preset]").forEach((button) => {
                button.addEventListener("click", async () => {
                    const preset = String(button.getAttribute("data-gl-preset") || "");
                    const today = await getServerTodayIso();
                    const base = new Date(`${today}T00:00:00Z`);
                    if (Number.isNaN(base.getTime()) || !dateFromInput || !dateToInput) {
                        return;
                    }

                    const toIso = today;
                    let fromIso = today;

                    if (preset === "thisMonth") {
                        fromIso = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-01`;
                    } else if (preset === "lastMonth") {
                        const last = new Date(base);
                        last.setUTCMonth(last.getUTCMonth() - 1);
                        const y = last.getUTCFullYear();
                        const m = String(last.getUTCMonth() + 1).padStart(2, "0");
                        fromIso = `${y}-${m}-01`;
                        const end = new Date(Date.UTC(y, last.getUTCMonth() + 1, 0));
                        dateToInput.value = end.toISOString().slice(0, 10);
                        dateFromInput.value = fromIso;
                        return;
                    } else if (preset === "ytd") {
                        fromIso = `${base.getUTCFullYear()}-01-01`;
                    }

                    dateFromInput.value = fromIso;
                    dateToInput.value = toIso;
                });
            });

            const resolveAccountId = (value) => {
                const normalized = String(value || "").trim().toLowerCase();
                if (!normalized) {
                    return "";
                }
                const exact = accountOptions.find((item) => String(item.label || "").toLowerCase() === normalized);
                if (exact) {
                    return String(exact.id || "");
                }
                return "";
            };

            const findSuggestions = async (query) => {
                const selectedBranchId = isBranchScopedRole
                    ? fixedBranchId
                    : String(form?.querySelector('[name="branch_id"]')?.value || "").trim();
                try {
                    const accounts = await searchLedgerAccountsByName(query, { branchId: selectedBranchId });
                    accountOptions = accounts.map((item) => ({
                        id: item.id,
                        label: `${item.code} - ${item.name}`
                    }));

                    if (accountList) {
                        accountList.innerHTML = "";
                        const optionNodes = accountOptions.map((item) => {
                            const option = document.createElement("option");
                            option.value = item.label;
                            return option;
                        });
                        accountList.replaceChildren(...optionNodes);
                    }
                } catch (error) {
                    if (statusNode) {
                        statusNode.textContent = error?.message || "Unable to search general ledgers.";
                    }
                }
            };

            openButton?.addEventListener("click", () => {
                openModal();
            });
            opTransactionOpenButton?.addEventListener("click", () => {
                openOpTransactionPickerModal();
            });

            trialBalanceOpenButton?.addEventListener("click", () => {
                openTrialBalanceModal();
            });

            modal?.querySelectorAll(".business-modal__close[data-gl-report-close]").forEach((control) => {
                control.addEventListener("click", () => closeModal());
            });
            statementModal?.querySelectorAll(".business-modal__close[data-gl-statement-close]").forEach((control) => {
                control.addEventListener("click", () => closeStatementModal(true));
            });
            entryModal?.querySelectorAll(".business-modal__close[data-gl-entry-close]").forEach((control) => {
                control.addEventListener("click", () => closeEntryModal());
            });
            opTransactionPickerModal?.querySelectorAll(".business-modal__close[data-op-transaction-picker-close]").forEach((control) => {
                control.addEventListener("click", () => closeOpTransactionPickerModal());
            });
            opTransactionStatementModal?.querySelectorAll(".business-modal__close[data-op-transaction-statement-close]").forEach((control) => {
                control.addEventListener("click", () => closeOpTransactionStatementModal());
            });
            trialBalanceModal?.querySelectorAll(".business-modal__close[data-trial-balance-close]").forEach((control) => {
                control.addEventListener("click", () => closeTrialBalanceModal());
            });
            trialBalanceStatementModal?.querySelectorAll(".business-modal__close[data-trial-balance-statement-close]").forEach((control) => {
                control.addEventListener("click", () => closeTrialBalanceStatementModal());
            });

            const trialDateFromInput = trialBalanceForm?.querySelector('input[name="date_from"]');
            const trialDateToInput = trialBalanceForm?.querySelector('input[name="date_to"]');
            void getServerTodayIso().then((todayIso) => {
                if (trialDateToInput && !trialDateToInput.value) {
                    trialDateToInput.value = todayIso;
                }
                if (trialDateFromInput && !trialDateFromInput.value) {
                    trialDateFromInput.value = getOneMonthBeforeIso(todayIso);
                }
            });

            trialBalanceForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!trialBalanceForm || !trialBalanceStatusNode || !trialBalanceStatementContent) {
                    return;
                }

                const data = new FormData(trialBalanceForm);
                const dateFrom = String(data.get("date_from") || "").trim();
                const dateTo = String(data.get("date_to") || "").trim();
                const branchId = isBranchScopedRole
                    ? fixedBranchId
                    : isAccountRole
                        ? scopeBranchId
                        : String(data.get("branch_id") || "").trim();

                trialBalanceStatusNode.textContent = "Loading trial balance...";
                setTrialBalanceViewState(true);
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const scopeLabel = resolveTrialBalanceScopeLabel(branchId);
                    const statement = await getTrialBalanceReport({
                        dateFrom,
                        dateTo,
                        branchId
                    });
                    statement.scopeLabel = scopeLabel;
                    selectedTrialBalanceStatement = statement;
                    trialBalanceStatementContent.innerHTML = renderTrialBalanceStatement(statement);
                    bindTrialBalanceActions();
                    trialBalanceStatusNode.textContent = "Trial balance loaded.";
                    closeTrialBalanceModal();
                    openTrialBalanceStatementModal();
                } catch (error) {
                    trialBalanceStatusNode.textContent = error?.message || "Unable to load trial balance.";
                    showToast(error?.message || "Unable to load trial balance.");
                } finally {
                    setTrialBalanceViewState(false);
                    await hideLoadingAfterPaint();
                }
            });

            if (isOperationsRole) {
                void getServerTodayIso().then((todayIso) => {
                    if (opTransactionDateTo && !opTransactionDateTo.value) {
                        opTransactionDateTo.value = todayIso;
                    }
                    if (opTransactionDateFrom && !opTransactionDateFrom.value) {
                        opTransactionDateFrom.value = getOneMonthBeforeIso(todayIso);
                    }
                });

                opTransactionForm?.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    if (!opTransactionForm || !opTransactionStatus || !opTransactionStatementContent) {
                        return;
                    }

                    const payload = new FormData(opTransactionForm);
                    const dateFrom = String(payload.get("date_from") || "").trim();
                    const dateTo = String(payload.get("date_to") || "").trim();
                    if (!dateFrom || !dateTo) {
                        opTransactionStatus.textContent = "Pick both date range values.";
                        return;
                    }

                    opTransactionStatus.textContent = "Loading transaction summary...";
                    setOpTransactionViewState(true);
                    window.TIA_PAGE_LOADING?.show?.();

                    try {
                        const rows = await getTransactionSummaryReport({
                            dateFrom,
                            dateTo,
                            branchId: fixedBranchId
                        });
                        opTransactionRows = rows;
                        opTransactionDetails = {
                            dateFrom,
                            dateTo,
                            branchName: fixedBranchLabel
                        };
                        opTransactionStatementContent.innerHTML = renderOperationTransactionSummaryStatement(opTransactionRows, opTransactionDetails);
                        bindOperationTransactionActions();
                        opTransactionStatus.textContent = `Loaded ${rows.length} transaction lines.`;
                        closeOpTransactionPickerModal();
                        openOpTransactionStatementModal();
                    } catch (error) {
                        opTransactionStatus.textContent = error?.message || "Unable to load transaction summary.";
                        showToast(error?.message || "Unable to load transaction summary.");
                    } finally {
                        setOpTransactionViewState(false);
                        await hideLoadingAfterPaint();
                    }
                });
            }

            searchInput?.addEventListener("input", () => {
                const value = String(searchInput.value || "").trim();
                if (!value) {
                    selectedAccount = null;
                    if (accountIdInput) accountIdInput.value = "";
                    if (searchTimer) {
                        window.clearTimeout(searchTimer);
                    }
                    searchTimer = window.setTimeout(() => {
                        void findSuggestions("");
                    }, 120);
                    return;
                }

                if (accountIdInput) {
                    accountIdInput.value = resolveAccountId(value);
                }

                if (searchTimer) {
                    window.clearTimeout(searchTimer);
                }

                searchTimer = window.setTimeout(() => {
                    void findSuggestions(value);
                }, 180);
            });

            if (isAccountRole) {
                form?.querySelector('[name="branch_id"]')?.addEventListener("change", () => {
                    if (accountIdInput) {
                        accountIdInput.value = "";
                    }
                    if (searchInput) {
                        searchInput.value = "";
                    }
                    accountOptions = [];
                    if (accountList) {
                        accountList.innerHTML = "";
                    }
                    selectedAccount = null;
                });
            }
            searchInput?.addEventListener("change", () => {
                if (!accountIdInput || !searchInput) {
                    return;
                }
                accountIdInput.value = resolveAccountId(searchInput.value);
            });

            searchInput?.addEventListener("focus", () => {
                void findSuggestions(String(searchInput.value || "").trim());
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form || !statusNode || !statementContent) {
                    return;
                }

                const data = new FormData(form);
                const accountId = String(data.get("account_id") || "").trim();
                const dateFrom = String(data.get("date_from") || "").trim();
                const dateTo = String(data.get("date_to") || "").trim();
                const branchId = isBranchScopedRole
                    ? fixedBranchId
                    : isAccountRole
                        ? scopeBranchId
                        : String(data.get("branch_id") || "").trim();

                const resolvedAccountId = accountId || resolveAccountId(searchInput?.value || "");
                if (!resolvedAccountId) {
                    statusNode.textContent = "Pick a General Ledger from the suggestion list before viewing.";
                    return;
                }

                statusNode.textContent = "Loading statement...";
                setViewState(true);
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    selectedStatement = await getGeneralLedgerStatement({
                        accountId: resolvedAccountId,
                        dateFrom,
                        dateTo,
                        branchId
                    });

                    statementViewState = {
                        page: 1,
                        pageSize: 25,
                        filters: {
                            reference: "",
                            description: "",
                            onlyDebit: false,
                            onlyCredit: false
                        }
                    };
                    renderStatementContent();
                    statusNode.textContent = "Statement loaded.";
                    closeModal();
                    openStatementModal();
                } catch (error) {
                    statusNode.textContent = error?.message || "Unable to load statement.";
                    showToast(error?.message || "Unable to load statement.");
                } finally {
                    setViewState(false);
                    await hideLoadingAfterPaint();
                }
            });

            void findSuggestions("");
        }
    };
}
