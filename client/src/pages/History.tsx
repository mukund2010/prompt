import { ChevronDown, ChevronRight, Copy, FolderOpen, GitCompareArrows, History as HistoryIcon, Search, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDate, formatDateTime, formatPct } from "../../../shared/format";
import type { Experiment, ExperimentSummary } from "../../../shared/types";
import { Button, Card, EmptyState, Loading, ModeBadge, Modal, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { useAction, useApp } from "../lib/state";

type Sort = "updated" | "name" | "best";

export default function History() {
  const { experiments, refreshList, setActiveId, activeId, confirm } = useApp();
  const navigate = useNavigate();
  const { run } = useAction();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [picked, setPicked] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Experiment>>({});
  const [compareOpen, setCompareOpen] = useState(false);

  const list = useMemo(() => {
    const l = (experiments ?? []).filter((e) => !q || `${e.name} ${e.promptPreview}`.toLowerCase().includes(q.toLowerCase()));
    return [...l].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "best" ? (b.bestPassRate ?? -1) - (a.bestPassRate ?? -1) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [experiments, q, sort]);

  const loadDetail = async (id: string) => {
    if (details[id]) return details[id];
    const e = await api.get(id);
    setDetails((d) => ({ ...d, [id]: e }));
    return e;
  };

  const open = (id: string) => {
    setActiveId(id);
    navigate("/studio");
  };
  const remove = async (e: ExperimentSummary) => {
    if (!(await confirm({ title: `Delete "${e.name}"?`, message: `This permanently deletes the experiment, its ${e.testCount} test cases, ${e.versionCount} versions and ${e.runCount} runs.`, confirmLabel: "Delete experiment", danger: true }))) return;
    const ok = await run(
      "del",
      async () => {
        await api.remove(e.id);
        return true;
      },
      "Experiment deleted.",
    );
    if (!ok) return;
    if (activeId === e.id) setActiveId(null);
    setPicked((p) => p.filter((x) => x !== e.id));
    void refreshList();
  };
  const duplicate = async (e: ExperimentSummary) => {
    const copy = await run("dup", () => api.duplicate(e.id), "Duplicated: tests and original prompt copied, runs not copied.");
    if (copy) void refreshList();
  };
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const startCompare = async () => {
    await Promise.all(picked.map(loadDetail));
    setCompareOpen(true);
  };

  if (!experiments) return <Loading />;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <HistoryIcon size={13} /> Library
          </>
        }
        title="Prompt History"
        desc="Every experiment, prompt version and run is saved. Reopen any of them, or compare two experiments side by side."
        actions={
          <Button variant="primary" icon={<GitCompareArrows size={15} />} disabled={picked.length !== 2} onClick={startCompare}>
            Compare selected ({picked.length}/2)
          </Button>
        }
      />

      {experiments.length === 0 ? (
        <Card>
          <EmptyState icon={<HistoryIcon size={26} />} title="No saved experiments" action={<Button variant="primary" onClick={() => navigate("/studio?new=1")}>Create an experiment</Button>}>
            Experiments are saved automatically as you work.
          </EmptyState>
        </Card>
      ) : (
        <Card bodyClass="">
          <div className="card-body row-between" style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--muted)" }} />
              <input className="input" style={{ paddingLeft: 30, width: 280, height: 36 }} placeholder="Search name or prompt…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" style={{ width: 200, height: 36, padding: "0 32px 0 12px" }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="updated">Sort: last updated</option>
              <option value="name">Sort: name</option>
              <option value="best">Sort: best pass rate</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th style={{ width: 28 }} />
                  <th>Experiment</th>
                  <th className="hide-mobile">Tests</th>
                  <th className="hide-mobile">Versions</th>
                  <th>Original → best</th>
                  <th className="hide-mobile">Mode</th>
                  <th className="hide-mobile">Updated</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const isOpen = expanded === e.id;
                  const d = details[e.id];
                  return (
                    <Fragment key={e.id}>
                      <tr className={activeId === e.id ? "selected" : ""}>
                        <td>
                          <input type="checkbox" checked={picked.includes(e.id)} onChange={() => togglePick(e.id)} aria-label={`Select ${e.name} for comparison`} />
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Show versions and runs"
                            icon={isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            onClick={async () => {
                              if (isOpen) return setExpanded(null);
                              setExpanded(e.id);
                              await run("detail", () => loadDetail(e.id));
                            }}
                          />
                        </td>
                        <td style={{ maxWidth: 360 }}>
                          <b className="link" onClick={() => open(e.id)}>
                            {e.name}
                          </b>
                          <div className="small muted truncate">{e.promptPreview}</div>
                        </td>
                        <td className="hide-mobile">{e.testCount}</td>
                        <td className="hide-mobile">{e.versionCount}</td>
                        <td className="nowrap">
                          {e.originalPassRate === null ? (
                            <span className="muted small">not run</span>
                          ) : (
                            <span>
                              {formatPct(e.originalPassRate)} → <b>{formatPct(e.bestPassRate)}</b>
                            </span>
                          )}
                        </td>
                        <td className="hide-mobile">{e.mode ? <ModeBadge mode={e.mode} /> : <span className="muted small">—</span>}</td>
                        <td className="small muted hide-mobile nowrap">{formatDate(e.updatedAt)}</td>
                        <td>
                          <div className="row" style={{ justifyContent: "flex-end", gap: 4, flexWrap: "nowrap" }}>
                            <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => open(e.id)}>
                              Open
                            </Button>
                            <Button size="sm" variant="ghost" icon={<Copy size={13} />} title="Duplicate" aria-label={`Duplicate ${e.name}`} onClick={() => duplicate(e)} />
                            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} title="Delete" aria-label={`Delete ${e.name}`} onClick={() => remove(e)} />
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={9} style={{ background: "var(--panel-2)", padding: 18 }}>
                            {!d ? (
                              <div className="skeleton" style={{ height: 80 }} />
                            ) : (
                              <div className="grid g-2">
                                <div>
                                  <div className="label">Versions</div>
                                  <ul className="checklist mt-8">
                                    {d.versions.map((v) => (
                                      <li key={v.id}>
                                        <span className="badge badge-neutral">{v.origin}</span>
                                        <span>
                                          <b>{v.label}</b> <span className="muted small">{formatDateTime(v.createdAt)}</span>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <div className="label">Runs ({d.runs.length})</div>
                                  <ul className="checklist mt-8">
                                    {[...d.runs].reverse().slice(0, 8).map((r) => (
                                      <li key={r.id}>
                                        <ModeBadge mode={r.mode} />
                                        <span className="small">
                                          {d.versions.find((v) => v.id === r.versionId)?.label} · <b>{r.summary.passRate}%</b> · {r.summary.completed} tests · {r.status} {r.scope === "partial" ? "(partial)" : ""} · <span className="muted">{formatDateTime(r.startedAt)}</span>
                                        </span>
                                      </li>
                                    ))}
                                    {!d.runs.length && <li className="muted small">No runs yet.</li>}
                                  </ul>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={compareOpen} onClose={() => setCompareOpen(false)} title="Experiment comparison" wide>
        <div className="vs" style={{ color: "var(--text)" }}>
          {picked.map((id) => {
            const e = details[id];
            const s = experiments.find((x) => x.id === id);
            if (!e || !s) return null;
            return (
              <div key={id} className="stack" style={{ gap: 10 }}>
                <b>{e.name}</b>
                <div className="small text-2">
                  {e.testCases.length} tests · {e.versions.length} versions · {e.runs.length} runs
                </div>
                <div className="row">
                  <span className="small muted">Original</span> <b>{formatPct(s.originalPassRate)}</b>
                  <span className="small muted">Best</span> <b className="grad-text">{formatPct(s.bestPassRate)}</b>
                  <ModeBadge mode={s.mode} />
                </div>
                <div className="label">Original prompt</div>
                <pre className="pre" style={{ maxHeight: 220 }}>{e.versions[0].prompt}</pre>
                <div className="label">Latest version: {e.versions.at(-1)!.label}</div>
                <pre className="pre" style={{ maxHeight: 220 }}>{e.versions.at(-1)!.prompt}</pre>
                <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => { setCompareOpen(false); open(id); }}>
                  Open this experiment
                </Button>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
