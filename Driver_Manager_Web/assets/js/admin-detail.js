
    // =====================================
    // 1. HIỂN THỊ THÔNG BÁO
    // =====================================

    function showMessage(message, success = false) {

      const messageBox =
        document.getElementById("password-message");

      messageBox.textContent = message;

      messageBox.style.color =
        success ? "#16a34a" : "#dc2626";

    }

    // =====================================
    // 2. KIỂM TRA VÀ LẤY THÔNG TIN ADMIN
    // =====================================

    let isAuthorizedAdmin = false;

    async function loadAdminInfo() {

      try {

        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
          cache: "no-store"
        });

        // Chưa đăng nhập
        if (response.status === 401) {
          window.top.location.replace("/login.html");
          return;
        }

        if (!response.ok) {
          throw new Error("Không thể tải thông tin Admin");
        }

        const data = await response.json();

        // Không phải Admin
        if (data.role !== "Admin") {
          window.top.location.replace("/driver.html");
          return;
        }

        isAuthorizedAdmin = true;

        document.getElementById("admin-id").value =
          data.id || "";

        document.getElementById("admin-username").value =
          data.username || "";

      } catch (error) {

        console.error("Lỗi tải Admin:", error);

        showMessage(
          "Không thể tải thông tin tài khoản!",
          false
        );

      }
    }

    // =====================================
    // 3. ĐỔI MẬT KHẨU ADMIN
    // =====================================

    document.getElementById("password-form")
      .addEventListener("submit", async function(event) {

        event.preventDefault();

        if (!isAuthorizedAdmin) {
          showMessage("Chưa xác thực tài khoản Admin!");
          return;
        }

        const currentPassword =
          document.getElementById("currentPassword").value;

        const newPassword =
          document.getElementById("newPassword").value;

        const confirmPassword =
          document.getElementById("confirmPassword").value;

        const saveButton =
          document.getElementById("btn-save");

        // Kiểm tra rỗng
        if (!currentPassword ||
            !newPassword ||
            !confirmPassword) {

          showMessage("Vui lòng nhập đầy đủ thông tin!");
          return;
        }

        // Kiểm tra độ dài
        if (newPassword.length < 8 ||
            newPassword.length > 128) {

          showMessage(
            "Mật khẩu mới phải có từ 8 đến 128 ký tự!"
          );

          return;
        }

        // Kiểm tra xác nhận
        if (newPassword !== confirmPassword) {

          showMessage("Mật khẩu xác nhận không khớp!");
          return;
        }

        // Không cho trùng mật khẩu cũ
        if (currentPassword === newPassword) {

          showMessage(
            "Mật khẩu mới phải khác mật khẩu hiện tại!"
          );

          return;
        }

        // Khóa nút
        saveButton.disabled = true;

        saveButton.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Đang cập nhật...';

        try {

          const response = await fetch(
            "/api/auth/change-password",
            {
              method: "POST",
              credentials: "same-origin",

              headers: {
                "Content-Type": "application/json"
              },

              body: JSON.stringify({
                currentPassword: currentPassword,
                newPassword: newPassword,
                confirmPassword: confirmPassword
              })
            }
          );

          // Phiên đăng nhập hết hạn
          if (response.status === 401) {

            window.top.location.replace("/login.html");
            return;
          }

          const data = await response.json();

          if (!response.ok) {

            showMessage(
              data.message || "Đổi mật khẩu thất bại!"
            );

            return;
          }

          // Đổi mật khẩu thành công
          showMessage(
            "Đổi mật khẩu thành công! Vui lòng đăng nhập lại.",
            true
          );

          document.getElementById("password-form").reset();

          // QUAN TRỌNG:
          // Thoát toàn bộ iframe và chuyển về Login
          window.top.location.replace("/login.html");

        } catch (error) {

          console.error("Lỗi đổi mật khẩu:", error);

          showMessage(
            "Không thể kết nối đến máy chủ!"
          );

        } finally {

          saveButton.disabled = false;

          saveButton.innerHTML =
            '<i class="fa-solid fa-floppy-disk"></i> Cập Nhật Mật Khẩu';

        }

      });

    // =====================================
    // 4. KHỞI TẠO
    // =====================================

    loadAdminInfo();
