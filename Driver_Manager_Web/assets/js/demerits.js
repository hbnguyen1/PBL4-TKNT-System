(() => {
    const filters = document.getElementById("violation-filters");
    const rows = document.getElementById("violation-rows");
    const status = document.getElementById("violation-status");
    const more = document.getElementById("violation-more");
    const filterButton = filters.querySelector("button[type=submit]");
    const api = "/api/ai-driving-events";
    const formatTime = new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Ho_Chi_Minh"
    });
    const reviewLabels = {
        pending: ["Chờ duyệt", "warning"],
        approved: ["Đã duyệt", "success"],
        rejected: ["Không duyệt", "danger"]
    };
    const renderedRows = new Map();
    const deletedIds = new Set();
    let before = null;
    let loading = false;
    let requestNumber = 0;
    let query = new URLSearchParams({ type: "violations" });

    for (let month = 1; month <= 12; month++) {
        filters.elements.month.add(new Option(`Tháng ${month}`, month));
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        node.className = className;
        node.textContent = text;
        return node;
    }

    function reviewBadge(state) {
        const [label, style] = reviewLabels[state] || reviewLabels.pending;
        return element("span", `badge badge--${style}`, label);
    }

    function lockRemoval(removal) {
        removal.replaceChildren(element("span", "badge badge--info", "Đã khóa xóa"));
    }

    function showPoints(event, cell) {
        const points = Number(event.pointsDeducted) || 0;
        if (points > 0) {
            cell.replaceChildren(element("span", "badge badge--danger", `-${points} điểm`));
        } else if (event.reviewStatus === "pending") {
            cell.textContent = `${event.rulePoints} điểm nếu duyệt`;
        } else {
            cell.textContent = "0 điểm";
        }
    }

    function updateReview(event, state, actions, pointsCell) {
        event.reviewStatus = state;
        event.pointsDeducted = state === "approved" ? event.rulePoints : 0;
        actions.replaceChildren(reviewBadge(state));
        showPoints(event, pointsCell);
    }

    async function review(event, nextStatus, actions, removal, pointsCell) {
        const buttons = actions.parentElement.querySelectorAll("button");
        buttons.forEach(button => { button.disabled = true; });
        try {
            const response = await fetch(`${api}/${event.id}/review`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: nextStatus })
            });
            if (response.status === 404) {
                await load(true);
                status.textContent = "Không tìm thấy biên bản để duyệt.";
                return;
            }
            if (response.status === 409) {
                const current = await response.json().catch(() => null);
                if (current?.status) {
                    updateReview(event, current.status, actions, pointsCell);
                    status.textContent = "Biên bản đã được quản trị viên xử lý.";
                } else {
                    actions.replaceChildren(reviewBadge(event.reviewStatus));
                    lockRemoval(removal);
                    status.textContent = current?.message || "Kỳ lương đã chốt.";
                }
                return;
            }
            if (!response.ok) throw new Error("Review failed");
            updateReview(event, nextStatus, actions, pointsCell);
            status.textContent = "Đã lưu kết quả phê duyệt.";
        } catch {
            status.textContent = "Chưa lưu được kết quả phê duyệt. Hãy thử lại.";
        } finally {
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    function forgetViolation(id) {
        const key = String(id);
        deletedIds.add(key);
        renderedRows.get(key)?.remove();
        renderedRows.delete(key);
    }

    async function removeEvent(event, code, actions, removal) {
        if (!confirm(`Bạn có chắc muốn xóa biên bản ${code}?`)) return;
        const buttons = actions.querySelectorAll("button");
        buttons.forEach(button => { button.disabled = true; });
        try {
            const response = await fetch(`${api}/${encodeURIComponent(event.id)}`, { method: "DELETE" });
            if (response.status === 404) {
                forgetViolation(event.id);
                await load(true);
                status.textContent = "Không tìm thấy biên bản để xóa.";
                return;
            }
            if (response.status === 409) {
                const result = await response.json().catch(() => null);
                lockRemoval(removal);
                status.textContent = result?.message || "Biên bản đã khóa xóa.";
                return;
            }
            if (!response.ok) throw new Error("Delete failed");
            window.pbl4NotifyViolationDeleted("ai", event.id);
            status.textContent = rows.childElementCount || before !== null
                ? `Đã xóa biên bản ${code}.`
                : "Đã xóa biên bản. Không còn biên bản vi phạm.";
        } catch {
            status.textContent = "Chưa xóa được biên bản. Hãy thử lại.";
        } finally {
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    function renderRow(event) {
        const row = document.createElement("tr");
        const code = `#DP-${String(event.id).padStart(3, "0")}`;
        const reference = element("td", "data-table__td demerits-record", code);
        reference.title = event.eventId;

        const driver = element("td", "data-table__td", "");
        const profile = element("a", "demerits-driver", event.driverName || event.driverId);
        profile.href = `driver-detail.html?id=${encodeURIComponent(event.driverId)}`;
        driver.append(profile, element("small", "demerits-reference", `${event.driverId} · ${event.vehiclePlate}`));

        const evidence = element("td", "data-table__td demerits-center", "");
        const image = element("a", "btn btn--secondary demerits-evidence", "");
        image.href = `${api}/${event.id}/image`;
        image.target = "_blank";
        image.rel = "noopener";
        const icon = element("i", "fa-solid fa-camera", "");
        icon.setAttribute("aria-hidden", "true");
        image.append(icon, " Xem ảnh");
        evidence.append(image);

        const reviewCell = element("td", "data-table__td demerits-center", "");
        const actionGroup = element("div", "demerits-actions", "");
        const actions = element("div", "demerits-actions", "");
        const removal = element("div", "demerits-actions", "");
        const points = element("td", "data-table__td demerits-center", "");
        showPoints(event, points);

        if (event.reviewStatus === "pending") {
            const approve = element("button", "btn btn--primary demerits-approve", "Duyệt");
            const reject = element("button", "btn btn--danger", "Không duyệt");
            approve.type = reject.type = "button";
            approve.setAttribute("aria-label", `Duyệt ${code}`);
            reject.setAttribute("aria-label", `Không duyệt ${code}`);
            approve.addEventListener("click", () => review(event, "approved", actions, removal, points));
            reject.addEventListener("click", () => review(event, "rejected", actions, removal, points));
            actions.append(approve, reject);
        } else {
            actions.append(reviewBadge(event.reviewStatus));
        }
        if (event.canDelete === true) {
            const remove = element("button", "btn btn--danger", "Xóa");
            remove.type = "button";
            remove.setAttribute("aria-label", `Xóa biên bản ${code}`);
            remove.addEventListener("click", () => removeEvent(event, code, actionGroup, removal));
            removal.append(remove);
        } else {
            lockRemoval(removal);
        }
        actionGroup.append(actions, removal);
        reviewCell.append(actionGroup);

        const phone = event.eventType === "phone_use";
        const violation = element("td", "data-table__td", phone ? "Sử dụng điện thoại" : "Buồn ngủ");
        if (phone) {
            violation.append(document.createElement("br"), element("span", "badge badge--danger", "Nghiêm trọng"));
        }
        row.append(reference, driver, violation, evidence, points,
            element("td", "data-table__td demerits-reference-time", formatTime.format(new Date(event.capturedAt))),
            reviewCell);
        return row;
    }

    async function load(reset = false) {
        if (loading && !reset) return;
        const request = ++requestNumber;
        loading = true;
        filterButton.disabled = more.disabled = true;
        if (reset) {
            before = null;
            rows.replaceChildren();
            renderedRows.clear();
            query = new URLSearchParams({ type: "violations" });
            for (const [key, value] of new FormData(filters)) {
                if (value.trim()) query.set(key, value.trim());
            }
        }
        status.textContent = "Đang tải biên bản…";
        const params = new URLSearchParams(query);
        if (before !== null) params.set("before", before);
        try {
            const response = await fetch(`${api}?${params}`, { cache: "no-store" });
            if (!response.ok) throw new Error("List failed");
            const data = await response.json();
            if (request !== requestNumber) return;
            for (const event of data.events) {
                const key = String(event.id);
                if (deletedIds.has(key) || renderedRows.has(key)) continue;
                const row = renderRow(event);
                renderedRows.set(key, row);
                rows.append(row);
            }
            before = data.nextBefore;
            more.hidden = before === null;
            more.textContent = "Xem thêm";
            status.textContent = rows.childElementCount ? "" : "Chưa có biên bản vi phạm.";
        } catch {
            if (request !== requestNumber) return;
            status.textContent = "Chưa tải được biên bản.";
            more.hidden = false;
            more.textContent = "Thử lại";
        } finally {
            if (request === requestNumber) {
                loading = false;
                filterButton.disabled = more.disabled = false;
            }
        }
    }

    filters.addEventListener("submit", event => {
        event.preventDefault();
        load(true);
    });
    window.addEventListener("pbl4:driving-event-deleted", ({ detail }) => {
        if (detail?.source !== "ai") return;
        forgetViolation(detail.id);
        if (!loading && !rows.childElementCount && before === null) {
            status.textContent = "Chưa có biên bản vi phạm.";
        }
    });
    window.addEventListener("pageshow", event => {
        if (event.persisted) load(true);
    });
    more.addEventListener("click", () => load());
    load();
})();
