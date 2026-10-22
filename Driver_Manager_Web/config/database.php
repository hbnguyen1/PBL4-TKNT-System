<?php
$host = "127.0.0.1";
$port = 3307; // nhập port bạn dùng
$dbname = "DriverWebDb";
$username = "root";
$password = "z"; // Mat khau MySQL cua ban

try {
    $pdo = new PDO(
        "mysql:host=$host;port=$port;dbname=$dbname;charset=utf8mb4",
        $username,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ]
    );

    echo "Ket noi MySQL thanh cong!";
} catch (PDOException $e) {
    http_response_code(500);
    exit("Loi ket noi MySQL: " . $e->getMessage());
}
