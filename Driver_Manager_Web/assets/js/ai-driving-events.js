(() => {
    const panel = document.querySelector("[data-ai-driving-events]");
    if (!panel) return;

    const admin = panel.dataset.aiDrivingEvents === "admin";
    const driverId = new URLSearchParams(location.search).get("id");
    const rows = panel.querySelector("tbody");
    const status = panel.querySelector("[role=status]");
    const more = panel.querySelector("[data-events-more]");
    const renderedRows = new Map();
    const deletedIds = new Set();
    const timeFormat = new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Asia/Ho_Chi_Minh"
    });
    const review = {
        pending: ["Chờ duyệt", "warning"],
        approved: ["Đã duyệt", "success"],
        rejected: ["Không duyệt", "danger"]
    };
    let before = null;
    let loading = false;
    let requestNumber = 0;

    function action(tag, label, icon, appearance = "secondary") {
        const element = document.createElement(tag);
        element.className = `btn btn--${appearance}`;
        const indicator = document.createElement("i");
        indicator.className = `fa-solid ${icon}`;
        indicator.setAttribute("aria-hidden", "true");
        element.append(indicator, label);
        return element;
    }

    function cell(row, content) {
        const element = row.insertCell();
        element.className = "data-table__td";
        element.append(content);
        return element;
    }

    function reportEmpty() {
        if (renderedRows.size) {
            status.textContent = "";
        } else {
            status.textContent = before === null ? "Chưa có sự kiện cần xem lại." : "Chọn Xem thêm để tải các sự kiện còn lại.";
        }
    }

    function lockedBadge() {
        const badge = document.createElement("span");
        badge.className = "badge badge--info";
        badge.textContent = "Đã khóa xóa";
        return badge;
    }

    async function removeViolation(event, button, code) {
        if (!window.confirm(`Xóa vi phạm ${code}?`)) return;

        button.disabled = true;
        try {
            const response = await fetch(`/api/ai-driving-events/${encodeURIComponent(event.id)}`, { method: "DELETE" });
            if (response.status === 409) {
                const result = await response.json().catch(() => null);
                button.replaceWith(lockedBadge());
                status.textContent = result?.message || "Biên bản đã khóa xóa.";
                return;
            }
            if (response.status === 404) {
                forgetViolation(event.id);
                status.textContent = "Không tìm thấy biên bản để xóa.";
                return;
            }
            if (!response.ok) throw new Error("Không thể xóa");
            window.pbl4NotifyViolationDeleted("ai", event.id);
            status.textContent = `Đã xóa vi phạm ${code}.`;
        } catch {
            status.textContent = `Không thể xóa vi phạm ${code}. Vui lòng thử lại.`;
        } finally {
            button.disabled = false;
        }
    }

    function render(event) {
        const id = String(event.id);
        if (deletedIds.has(id) || renderedRows.has(id)) return;

        if (event.eventType !== "phone_use" && event.eventType !== "drowsy") return;
        const code = `#DP-${id.padStart(3, "0")}`;
        const row = rows.insertRow();
        renderedRows.set(id, row);

        const reference = document.createElement("strong");
        reference.className = "ai-driving-events__reference";
        reference.textContent = code;
        reference.title = event.eventId;
        cell(row, reference);
        const description = event.eventType === "phone_use" ? "Sử dụng điện thoại" : "Buồn ngủ";
        cell(row, description);
        cell(row, event.vehiclePlate || "—");

        const date = new Date(event.capturedAt);
        const time = document.createElement("time");
        if (Number.isNaN(date.getTime())) {
            time.textContent = "—";
        } else {
            time.dateTime = date.toISOString();
            time.textContent = timeFormat.format(date);
        }
        cell(row, time);

        const [label, appearance] = review[event.reviewStatus] || review.pending;
        const badge = document.createElement("span");
        badge.className = `badge badge--${appearance}`;
        badge.textContent = label;
        cell(row, badge);
        const points = Number(event.pointsDeducted) || 0;
        cell(row, points > 0 ? `-${points} điểm` : "—");

        const actions = document.createElement("div");
        actions.className = "ai-driving-events__actions";
        const picture = `/api/ai-driving-events/${encodeURIComponent(id)}/image`;
        const view = action("a", "Xem ảnh", "fa-image");
        view.href = picture;
        view.target = "_blank";
        view.rel = "noopener";

        const download = action("a", "Tải ảnh", "fa-download");
        download.href = picture;
        download.download = `pbl4-${event.eventId}.jpg`;
        actions.append(view, download);
        cell(row, actions);

        if (admin) {
            const controls = cell(row, "");
            if (event.canDelete === true) {
                const remove = action("button", "Xóa", "fa-trash-can", "danger");
                remove.type = "button";
                remove.setAttribute("aria-label", `Xóa vi phạm ${code}`);
                remove.addEventListener("click", () => removeViolation(event, remove, code));
                controls.append(remove);
            } else {
                controls.append(lockedBadge());
            }
        }
    }

    async function load(reset = false) {
        if (loading && !reset) return;
        if (admin && !driverId) {
            status.textContent = "Thiếu mã tài xế để tải sự kiện.";
            return;
        }

        const request = ++requestNumber;
        loading = true;
        more.disabled = true;
        if (reset) {
            before = null;
            rows.replaceChildren();
            renderedRows.clear();
        }
        status.textContent = "Đang tải sự kiện…";
        const query = new URLSearchParams({ type: "violations" });
        if (admin) query.set("driverId", driverId);
        if (before !== null) query.set("before", before);
        try {
            const response = await fetch(`/api/ai-driving-events?${query}`, { cache: "no-store" });
            if (!response.ok) throw new Error("Không thể tải sự kiện");
            const data = await response.json();
            if (request !== requestNumber) return;
            for (const event of data.events) render(event);
            before = data.nextBefore;
            more.hidden = before === null;
            more.textContent = "Xem thêm";
            reportEmpty();
        } catch {
            if (request !== requestNumber) return;
            status.textContent = "Chưa tải được sự kiện.";
            more.hidden = false;
            more.textContent = "Thử lại";
        } finally {
            if (request === requestNumber) {
                more.disabled = false;
                loading = false;
            }
        }
    }

    function forgetViolation(id) {
        const key = String(id);
        deletedIds.add(key);
        const row = renderedRows.get(key);
        if (!row) return;
        row.remove();
        renderedRows.delete(key);
        if (!loading) reportEmpty();
    }

    window.addEventListener("pbl4:driving-event-deleted", ({ detail }) => {
        if (detail?.source === "ai") forgetViolation(detail.id);
    });
    window.addEventListener("pageshow", event => {
        if (event.persisted) load(true);
    });
    more.addEventListener("click", () => load());
    load();
})();
