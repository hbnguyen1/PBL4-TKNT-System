(() => {
    const eventName = "pbl4:driving-event-deleted";
    const channel = typeof BroadcastChannel === "function"
        ? new BroadcastChannel("pbl4-violation-deletions")
        : null;

    function notify(detail) {
        if (detail?.source !== "ai" && detail?.source !== "demerit") return;
        const id = String(detail.id);
        if (!/^[1-9]\d*$/.test(id)) return;
        const normalized = { source: detail.source, id };
        window.dispatchEvent(new CustomEvent(eventName, { detail: normalized }));
        return normalized;
    }

    channel?.addEventListener("message", event => notify(event.data));

    window.pbl4NotifyViolationDeleted = (source, id) => {
        const detail = notify({ source, id });
        if (detail) channel?.postMessage(detail);
    };
})();
