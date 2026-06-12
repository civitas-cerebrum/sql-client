-- MSSQL schema for bookhive. Drop order respects FK constraints.
-- DROP TABLE IF EXISTS makes this script rerunnable (no GO batch separators).

DROP TABLE IF EXISTS marketplace_listings;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS books;

CREATE TABLE books (
    book_id      NVARCHAR(255) PRIMARY KEY,
    title        NVARCHAR(255) NOT NULL,
    author       NVARCHAR(255) NOT NULL,
    genre        NVARCHAR(255) NOT NULL,
    description  NVARCHAR(MAX),
    price        DECIMAL(10,2) NOT NULL,
    cover_image  NVARCHAR(255),
    stock        INTEGER NOT NULL DEFAULT 0,
    isbn         NVARCHAR(255) UNIQUE
);

CREATE TABLE users (
    user_id       NVARCHAR(255) PRIMARY KEY,
    username      NVARCHAR(255) NOT NULL UNIQUE,
    email         NVARCHAR(255) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    created_at    DATETIMEOFFSET NOT NULL
);

CREATE TABLE orders (
    order_id     NVARCHAR(255) PRIMARY KEY,
    user_id      NVARCHAR(255) NOT NULL,
    total_price  DECIMAL(10,2) NOT NULL,
    [status]     NVARCHAR(255) NOT NULL,
    purchased_at DATETIMEOFFSET NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE order_items (
    order_item_id     NVARCHAR(255) PRIMARY KEY,
    order_id          NVARCHAR(255) NOT NULL,
    book_id           NVARCHAR(255) NOT NULL,
    quantity          INTEGER NOT NULL,
    price_at_purchase DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
);

CREATE TABLE cart_items (
    cart_item_id NVARCHAR(255) PRIMARY KEY,
    user_id      NVARCHAR(255) NOT NULL,
    book_id      NVARCHAR(255) NOT NULL,
    quantity     INTEGER NOT NULL,
    added_at     DATETIMEOFFSET NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
);

CREATE TABLE marketplace_listings (
    listing_id  NVARCHAR(255) PRIMARY KEY,
    seller_id   NVARCHAR(255) NOT NULL,
    book_id     NVARCHAR(255) NOT NULL,
    [condition] NVARCHAR(255) NOT NULL,
    price       DECIMAL(10,2) NOT NULL,
    listed_at   DATETIMEOFFSET NOT NULL,
    [status]    NVARCHAR(255) NOT NULL,
    FOREIGN KEY (seller_id) REFERENCES users(user_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_book  ON order_items(book_id);
CREATE INDEX idx_orders_user       ON orders(user_id);
CREATE INDEX idx_cart_user         ON cart_items(user_id);
CREATE INDEX idx_listings_book     ON marketplace_listings(book_id);
