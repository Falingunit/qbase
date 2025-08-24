"use strict";
(async function () {
  const params = new URLSearchParams(window.location.search);
  const qRaw = params.get("q") || "";
  const query = qRaw.trim().toLowerCase();

  document.title = qRaw ? `Search – ${qRaw}` : "QBase – Search";

  const els = {
    aList: document.getElementById("assignment-results"),
    aEmpty: document.getElementById("assignment-empty"),
    wList: document.getElementById("worksheet-results"),
    wEmpty: document.getElementById("worksheet-empty"),
  };

  try {
    const [aData, wData] = await Promise.all([
      fetch("./data/assignment_list.json").then((r) => r.json()).catch(() => []),
      fetch("./data/worksheets/worksheet_list.json")
        .then((r) => r.json())
        .catch(() => []),
    ]);

    const assignments = Array.isArray(aData) ? aData : [];
    const worksheets = normalizeWorksheets(wData);

    renderAssignments(filterAssignments(assignments, query));
    renderWorksheets(filterWorksheets(worksheets, query));
  } catch (err) {
    console.error("Search failed:", err);
    els.aEmpty.classList.remove("d-none");
    els.wEmpty.classList.remove("d-none");
  }

  function filterAssignments(list, q) {
    if (!q) return list;
    return list.filter((it) => {
      const hay = [
        it.title,
        it.subject,
        it.chapter,
        it.faculty,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderAssignments(list) {
    if (list.length === 0) {
      els.aEmpty.classList.remove("d-none");
      return;
    }
    list.forEach((it) => {
      const a = document.createElement("a");
      a.className = "list-group-item list-group-item-action";
      a.href = `./assignment.html?aID=${encodeURIComponent(it.aID || "")}`;
      a.textContent = `${it.subject || ""} – ${it.title || "Assignment"}`;
      els.aList.appendChild(a);
    });
  }

  function filterWorksheets(list, q) {
    if (!q) return list;
    return list.filter((it) => {
      const hay = [it.title, it.subject, it.chapter]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderWorksheets(list) {
    if (list.length === 0) {
      els.wEmpty.classList.remove("d-none");
      return;
    }
    list.forEach((it) => {
      const a = document.createElement("a");
      a.className = "list-group-item list-group-item-action";
      a.href = `./worksheet.html?wID=${encodeURIComponent(it.wID || "")}`;
      a.textContent = `${it.subject || ""} – ${it.title || "Worksheet"}`;
      els.wList.appendChild(a);
    });
  }

  function normalizeWorksheets(input) {
    const out = [];
    const pushItem = (raw, subjHint) => {
      if (!raw) return;
      const subject = (raw.subject || subjHint || "").toString();
      const chapter = (
        raw.chapter ||
        raw.chapterName ||
        raw.topic ||
        ""
      ).toString();
      const title = (
        raw.title ||
        raw.name ||
        raw.worksheetTitle ||
        raw.label ||
        raw.file ||
        "Worksheet"
      ).toString();
      const wID = String(
        raw.wID || raw.id || raw.wid || generateWID(subject, chapter, title)
      );
      out.push({ subject, chapter, title, wID });
    };

    if (Array.isArray(input)) {
      input.forEach((it) => pushItem(it));
    } else if (input && Array.isArray(input.worksheets)) {
      input.worksheets.forEach((it) => pushItem(it));
    } else if (input && Array.isArray(input.items)) {
      input.items.forEach((it) => pushItem(it));
    } else if (input && typeof input === "object") {
      Object.entries(input).forEach(([subj, arr]) => {
        if (Array.isArray(arr)) arr.forEach((it) => pushItem(it, subj));
      });
    }

    return out;
  }

  function generateWID(subject, chapter, title) {
    const slug = (s) =>
      String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
    return [slug(subject), slug(chapter), slug(title)]
      .filter(Boolean)
      .join("-");
  }
})();

