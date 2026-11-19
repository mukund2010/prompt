import { Download, Eye, FileCode2, FileJson, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDateTime, formatPct, formatSigned } from "../../../shared/format";
import { compareRuns } from "../../../shared/metrics";
import { defaultComparison, latestImprovedVersion } from "../../../shared/selectors";
import { NeedsExperiment } from "../components/Layout";
import { Banner, Button, Card, ModeBadge, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../lib/state";

export default function Reports() {
  return (
    <NeedsExperiment>
      <ReportsInner />
    </NeedsExperiment>
  );
}

const FORMATS = [
  { id: "html" as const, icon: <FileCode2 size={20} />, title: "HTML report", text: "Standalone, styled and printable. Use your browser's Print → Save as PDF for a PDF copy." },
  { id: "md" as const, icon: <FileText size={20} />, title: "Markdown report", text: "Plain-text report for GitHub, wikis or project documentation." },
  { id: "json" as const, icon: <FileJson size={20} />, title: "JSON export", text: "Complete raw experiment data (tests, outputs, verdicts, versions) for further analysis." },
];

function ReportsInner() {
  const { active, toast } = useApp();
  const exp = active!;
  const [preview, setPreview] = useState(false);
  const { baseline, candidate, candidateVersion } = defaultComparison(exp);
  const cmp = baseline && candidate ? compareRuns(baseline, candidate) : null;
  const hasDemo = exp.runs.some((r) => r.mode === "demo");
  useEffect(() => setPreview(false), [exp.id]);

  const download = async (format: "md" | "html" | "json") => {
    try {
      const res = await fetch(api.reportUrl(exp.id, format));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Download failed (${res.status}).`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`Downloaded ${name}`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <FileText size={13} /> Library
          </>
        }
        title="Reports"
        desc={`Downloadable testing report for "${exp.name}": prompts, test cases, actual outputs, failure explanations, pass/fail results, comparison and recommendations.`}
      />
      {hasDemo && <Banner kind="demo">This experiment contains demo runs. Reports clearly mark demonstration data so it is never mistaken for real model results.</Banner>}

      <div className="grid g-4">
        <Card>
          <div className="small muted">Test cases</div>
          <div className="stat-value">{exp.testCases.length}</div>
        </Card>
        <Card>
          <div className="small muted">Original pass rate</div>
          <div className="stat-value">{formatPct(baseline?.summary.passRate)}</div>
          {baseline && <ModeBadge mode={baseline.mode} />}
        </Card>
        <Card>
          <div className="small muted">Improved pass rate{candidateVersion ? ` (${candidateVersion.label})` : ""}</div>
          <div className="stat-value accent">{formatPct(candidate?.summary.passRate)}</div>
          {candidate && <ModeBadge mode={candidate.mode} />}
        </Card>
        <Card>
          <div className="small muted">Change</div>
          <div className={`stat-value ${cmp && cmp.passRateDelta > 0 ? "delta-up" : cmp && cmp.passRateDelta < 0 ? "delta-down" : ""}`}>{cmp ? formatSigned(cmp.passRateDelta, " pts") : "—"}</div>
          {cmp && <div className="small muted">{cmp.fixed} fixed · {cmp.regressed} regressed</div>}
        </Card>
      </div>

      {!baseline && <Banner>No full run of the original prompt yet, so the report will contain the prompt and test cases but no results.</Banner>}
      {baseline && !candidate && <Banner>No retested improved version yet{latestImprovedVersion(exp) ? `. ${latestImprovedVersion(exp)!.label} exists but has not been run` : ""}. The report will include original results only.</Banner>}

      <div className="grid g-3">
        {FORMATS.map((f) => (
          <Card key={f.id}>
            <div className="stack" style={{ gap: 10 }}>
              <span className="empty-icon" style={{ width: 42, height: 42, margin: 0, borderRadius: 12 }}>
                {f.icon}
              </span>
              <b>{f.title}</b>
              <p className="small text-2" style={{ margin: 0, minHeight: 40 }}>
                {f.text}
              </p>
              <div className="row">
                <Button variant="primary" icon={<Download size={15} />} onClick={() => download(f.id)}>
                  Download
                </Button>
                {f.id === "html" && (
                  <Button icon={<Eye size={15} />} onClick={() => setPreview((p) => !p)}>
                    {preview ? "Hide preview" : "Preview"}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {preview && (
        <Card title="Report preview" sub={`Generated live · ${formatDateTime(new Date().toISOString())}`} bodyClass="">
          <iframe title="Report preview" src={api.reportUrl(exp.id, "html", true)} style={{ width: "100%", height: 760, border: 0, background: "#fff", borderRadius: "0 0 14px 14px" }} sandbox="" />
        </Card>
      )}
    </div>
  );
}
