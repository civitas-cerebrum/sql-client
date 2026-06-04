CREATE TABLE books (
    book_id      VARCHAR(255) PRIMARY KEY,
    title        VARCHAR(255) NOT NULL,
    author       VARCHAR(255) NOT NULL,
    genre        VARCHAR(255) NOT NULL,
    description  TEXT,
    price        DECIMAL(10,2) NOT NULL,
    cover_image  VARCHAR(255),
    stock        INTEGER NOT NULL DEFAULT 0,
    isbn         VARCHAR(255) UNIQUE
);

CREATE TABLE users (
    user_id       VARCHAR(255) PRIMARY KEY,
    username      VARCHAR(255) NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at    DATETIME NOT NULL
);

CREATE TABLE orders (
    order_id     VARCHAR(255) PRIMARY KEY,
    user_id      VARCHAR(255) NOT NULL,
    total_price  DECIMAL(10,2) NOT NULL,
    status       VARCHAR(255) NOT NULL,
    purchased_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE order_items (
    order_item_id     VARCHAR(255) PRIMARY KEY,
    order_id          VARCHAR(255) NOT NULL,
    book_id           VARCHAR(255) NOT NULL,
    quantity          INTEGER NOT NULL,
    price_at_purchase DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
);

CREATE TABLE cart_items (
    cart_item_id VARCHAR(255) PRIMARY KEY,
    user_id      VARCHAR(255) NOT NULL,
    book_id      VARCHAR(255) NOT NULL,
    quantity     INTEGER NOT NULL,
    added_at     DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
);

CREATE TABLE marketplace_listings (
    listing_id VARCHAR(255) PRIMARY KEY,
    seller_id  VARCHAR(255) NOT NULL,
    book_id    VARCHAR(255) NOT NULL,
    `condition` VARCHAR(255) NOT NULL,
    price      DECIMAL(10,2) NOT NULL,
    listed_at  DATETIME NOT NULL,
    status     VARCHAR(255) NOT NULL,
    FOREIGN KEY (seller_id) REFERENCES users(user_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_book  ON order_items(book_id);
CREATE INDEX idx_orders_user       ON orders(user_id);
CREATE INDEX idx_cart_user         ON cart_items(user_id);
CREATE INDEX idx_listings_book     ON marketplace_listings(book_id);
