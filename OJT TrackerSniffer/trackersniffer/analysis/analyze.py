"""Optional sector analysis, step 2: clean the audit results and compare news vs e-commerce.

Usage:  python analysis/analyze.py [--in analysis/output] [--out analysis/output]
Needs:  pip install pandas matplotlib
Writes: charts (*.png), sector_summary.csv, summary.md in the output folder.
"""
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

# Categorical colours (fixed order) and status colours, validated for colour-blind separation.
SECTOR_COLORS = {"news": "#2a78d6", "e-commerce": "#eb6834"}
STATUS_COLORS = {"complete": "#0ca30c", "partial": "#fab219", "failed": "#d03b3b", "unsupported": "#8a8984"}
TEXT, MUTED, GRID = "#0b0b0b", "#52514e", "#e1e0da"


def style(ax, title, xlabel=None, ylabel=None, note=None):
    ax.set_title(title, loc="left", fontsize=12, color=TEXT, pad=12)
    if xlabel:
        ax.set_xlabel(xlabel, color=MUTED)
    if ylabel:
        ax.set_ylabel(ylabel, color=MUTED)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=MUTED)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    if note:
        ax.figure.text(0.01, 0.01, note, fontsize=8, color=MUTED, ha="left", va="bottom", wrap=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="inp", default=str(Path(__file__).parent / "output"))
    p.add_argument("--out", default=None)
    a = p.parse_args()
    inp = Path(a.inp)
    out = Path(a.out) if a.out else inp
    out.mkdir(parents=True, exist_ok=True)

    audits = pd.read_csv(inp / "audits.csv")
    domains = pd.read_csv(inp / "domains.csv") if (inp / "domains.csv").exists() else pd.DataFrame()
    meta = json.loads((inp / "run-metadata.json").read_text()) if (inp / "run-metadata.json").exists() else {}
    log = []

    # ---------- cleaning ----------
    n0 = len(audits)
    audits["site_sector"] = audits["site_sector"].str.strip().str.lower()
    audits = audits.drop_duplicates(subset=["site_url"], keep="last")
    log.append(f"Duplicate site rows removed: {n0 - len(audits)}")
    unknown_sector = ~audits["site_sector"].isin(["news", "e-commerce"])
    log.append(f"Rows with a sector other than news/e-commerce excluded from sector comparisons: {int(unknown_sector.sum())}")
    audits = audits[~unknown_sector]
    numeric = ["third_party_domains", "recognized_tracker_domains", "accessible_cookie_count", "third_party_cookie_count",
               "privacy_score", "tracker_density", "unique_request_domains", "unknown_third_party_domains", "audit_duration_seconds"]
    for c in numeric:
        audits[c] = pd.to_numeric(audits[c], errors="coerce")

    # ---------- completion ----------
    completion = audits.groupby("site_sector")["audit_status"].value_counts().unstack(fill_value=0)
    for s in ["complete", "partial", "failed", "unsupported"]:
        if s not in completion:
            completion[s] = 0
    completion = completion[["complete", "partial", "failed", "unsupported"]]
    completion["attempted"] = completion.sum(axis=1)
    completion["completion_rate_pct"] = (completion["complete"] / completion["attempted"] * 100).round(1)

    complete = audits[audits["audit_status"] == "complete"].copy()
    scored = audits[audits["audit_status"].isin(["complete", "partial"]) & audits["privacy_score"].notna()].copy()

    def summarize(df):
        g = df.groupby("site_sector")
        s = pd.DataFrame({
            "n": g.size(),
            "mean_trackers": g["recognized_tracker_domains"].mean().round(2),
            "median_trackers": g["recognized_tracker_domains"].median(),
            "mean_third_party_domains": g["third_party_domains"].mean().round(2),
            "median_tracker_density_pct": g["tracker_density"].median().round(1),
            "sector_tracker_density_pct": (g["recognized_tracker_domains"].sum() / g["third_party_domains"].sum() * 100).round(1),
            "median_third_party_cookies": g["third_party_cookie_count"].median(),
            "median_privacy_score": g["privacy_score"].median(),
        })
        return s

    summary_complete = summarize(complete)
    summary_scored = summarize(scored)
    summary_complete.to_csv(out / "sector_summary.csv")
    completion.to_csv(out / "audit_completion.csv")

    sectors = [s for s in ["news", "e-commerce"] if s in summary_complete.index]
    colors = [SECTOR_COLORS[s] for s in sectors]
    charts = []

    # 1. mean & median trackers
    if sectors:
        fig, ax = plt.subplots(figsize=(7, 4.2))
        x = range(len(sectors))
        w = 0.36
        means = summary_complete.loc[sectors, "mean_trackers"]
        medians = summary_complete.loc[sectors, "median_trackers"]
        b1 = ax.bar([i - w / 2 for i in x], means, w, color=colors, edgecolor="white", linewidth=2, label="Mean")
        b2 = ax.bar([i + w / 2 for i in x], medians, w, color=colors, alpha=0.55, edgecolor="white", linewidth=2, hatch="//", label="Median")
        ax.bar_label(b1, fmt="%.1f", color=TEXT, fontsize=9)
        ax.bar_label(b2, fmt="%.1f", color=TEXT, fontsize=9)
        ax.set_xticks(list(x), [f"{s}\n(n={int(summary_complete.loc[s, 'n'])})" for s in sectors])
        ax.legend(frameon=False)
        style(ax, "Recognized tracker domains per site (complete audits)", ylabel="Tracker domains per site",
              note="Mean (solid) and median (hatched). Observed during a fixed window on the home page, before consent.")
        fig.tight_layout(rect=(0, 0.05, 1, 1))
        fig.savefig(out / "01_trackers_mean_median.png", dpi=160)
        plt.close(fig)
        charts.append(("01_trackers_mean_median.png", "Mean and median recognized tracker domains per site, by sector."))

    # 2. tracker density distribution
    if sectors:
        fig, ax = plt.subplots(figsize=(7, 4.2))
        data = [complete.loc[(complete.site_sector == s) & complete.tracker_density.notna(), "tracker_density"] for s in sectors]
        bp = ax.boxplot(data, patch_artist=True, widths=0.45, medianprops={"color": TEXT, "linewidth": 2})
        for patch, c in zip(bp["boxes"], colors):
            patch.set_facecolor(c)
            patch.set_alpha(0.75)
        for i, d in enumerate(data, start=1):
            ax.scatter([i] * len(d), d, s=12, color=TEXT, alpha=0.35, zorder=3)
        ax.set_xticks(range(1, len(sectors) + 1), [f"{s}\n(n={len(d)})" for s, d in zip(sectors, data)])
        style(ax, "Tracker density by sector (complete audits)", ylabel="Tracker domains / third-party domains (%)",
              note="Tracker density = recognized tracker domains ÷ unique third-party domains × 100. Sites with no third-party domains are excluded (n/a).")
        fig.tight_layout(rect=(0, 0.05, 1, 1))
        fig.savefig(out / "02_tracker_density.png", dpi=160)
        plt.close(fig)
        charts.append(("02_tracker_density.png", "Distribution of tracker density per site, by sector."))

    # 3. audit completion
    if len(completion):
        fig, ax = plt.subplots(figsize=(7, 4.2))
        left = pd.Series(0, index=completion.index)
        for s in ["complete", "partial", "failed", "unsupported"]:
            vals = completion[s]
            if vals.sum() == 0:
                continue
            ax.barh(completion.index, vals, left=left, color=STATUS_COLORS[s], edgecolor="white", linewidth=2, label=s)
            for i, (v, l) in enumerate(zip(vals, left)):
                if v:
                    ax.text(l + v / 2, i, str(int(v)), ha="center", va="center", fontsize=9, color=TEXT)
            left = left + vals
        ax.legend(frameon=False, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.15))
        ax.grid(axis="x", color=GRID)
        style(ax, "Audit completion by sector", xlabel="Sites attempted")
        ax.grid(axis="y", visible=False)
        fig.tight_layout()
        fig.savefig(out / "03_audit_completion.png", dpi=160)
        plt.close(fig)
        charts.append(("03_audit_completion.png", "Completed, partial and failed audits per sector."))

    # 4. classification coverage
    if sectors:
        fig, ax = plt.subplots(figsize=(7, 4.2))
        known = complete.groupby("site_sector")["recognized_tracker_domains"].sum()
        unknown = complete.groupby("site_sector")["unknown_third_party_domains"].sum()
        tot = known + unknown
        kp = (known / tot * 100).reindex(sectors)
        up = (unknown / tot * 100).reindex(sectors)
        ax.bar(sectors, kp, color=colors, edgecolor="white", linewidth=2, label="On tracker list")
        ax.bar(sectors, up, bottom=kp, color="#d9d8d2", edgecolor="white", linewidth=2, label="Unknown (not on list)")
        for i, s in enumerate(sectors):
            ax.text(i, kp[s] / 2, f"{kp[s]:.0f}%", ha="center", va="center", color="white", fontsize=10)
            ax.text(i, kp[s] + up[s] / 2, f"{up[s]:.0f}%", ha="center", va="center", color=TEXT, fontsize=10)
        ax.set_ylim(0, 100)
        ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
        style(ax, "Third-party domains: recognized vs unknown", ylabel="Share of third-party domains (%)")
        fig.tight_layout()
        fig.savefig(out / "04_classification_coverage.png", dpi=160)
        plt.close(fig)
        charts.append(("04_classification_coverage.png", "Share of third-party domains the tracker list could classify."))

    # 5. most common tracker owners
    top = pd.DataFrame()
    if len(domains):
        d = domains[(domains["party"] == "third-party") & (domains["is_known_tracker"].astype(str).str.lower() == "true")]
        d = d[d["site_url"].isin(complete["site_url"])]
        d = d.assign(owner=d["owner"].fillna(d["domain"]))
        top = d.groupby("owner")["site_url"].nunique().sort_values(ascending=False).head(12)
        if len(top):
            fig, ax = plt.subplots(figsize=(7, 4.8))
            ax.barh(top.index[::-1], top.values[::-1], color=SECTOR_COLORS["news"], edgecolor="white", linewidth=2)
            for i, v in enumerate(top.values[::-1]):
                ax.text(v + 0.3, i, str(int(v)), va="center", fontsize=9, color=TEXT)
            ax.grid(axis="x", color=GRID)
            style(ax, f"Tracker owners seen on the most sites (of {len(complete)} complete audits)", xlabel="Number of sites")
            ax.grid(axis="y", visible=False)
            fig.tight_layout()
            fig.savefig(out / "05_top_tracker_owners.png", dpi=160)
            plt.close(fig)
            charts.append(("05_top_tracker_owners.png", "Tracker owners (companies) present on the largest number of sites."))

    # ---------- summary ----------
    def fmt(v):
        if pd.isna(v):
            return "n/a"
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)

    def md_table(df):
        cols = list(df.columns)
        lines = ["| sector | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
        for idx, r in df.iterrows():
            lines.append(f"| {idx} | " + " | ".join(fmt(v) for v in r.values) + " |")
        return "\n".join(lines)

    text = [
        "# Sector analysis summary",
        "",
        f"Run: {meta.get('started_at', 'n/a')} · window {meta.get('wait_seconds', 'n/a')} s · Chrome {meta.get('chrome_version', 'n/a')} · headless={meta.get('headless', 'n/a')} · tracker list {meta.get('tracker_list', {}).get('version', 'n/a')}",
        "",
        "## Audit completion",
        "",
        md_table(completion),
        "",
        "## Complete audits only",
        "",
        md_table(summary_complete),
        "",
        "## Robustness check: complete + partial audits",
        "",
        md_table(summary_scored),
        "",
        "## Cleaning log",
        "",
        *[f"- {line}" for line in log],
        "",
        "## Charts",
        "",
        *[f"- `{f}` — {desc}" for f, desc in charts],
        "",
        "Limitations: home pages only, one fixed observation window, no consent interaction, a single location and browser profile, and a hand-picked (not random) site list. Results describe this sample, not all news or e-commerce websites.",
    ]
    (out / "summary.md").write_text("\n".join(text) + "\n")
    print("\n".join(text))


if __name__ == "__main__":
    main()
