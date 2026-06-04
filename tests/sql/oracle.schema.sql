-- Oracle schema for bookhive.
-- Drop tables in FK-safe order, swallowing ORA-00942 (table or view does not exist).
-- NOTE: "condition" is a reserved word in Oracle — renamed to item_condition.

BEGIN EXECUTE IMMEDIATE 'DROP TABLE marketplace_listings'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE cart_items'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE order_items'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE orders'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE users'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE books'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;
/

CREATE TABLE books (
    book_id     VARCHAR2(255) PRIMARY KEY,
    title       VARCHAR2(255) NOT NULL,
    author      VARCHAR2(255) NOT NULL,
    genre       VARCHAR2(255) NOT NULL,
    description VARCHAR2(2000),
    price       NUMBER(10,2) NOT NULL,
    cover_image VARCHAR2(255),
    stock       NUMBER(10) DEFAULT 0 NOT NULL,
    isbn        VARCHAR2(255) UNIQUE
)
/

CREATE TABLE users (
    user_id       VARCHAR2(255) PRIMARY KEY,
    username      VARCHAR2(255) NOT NULL UNIQUE,
    email         VARCHAR2(255) NOT NULL UNIQUE,
    password_hash VARCHAR2(255) NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL
)
/

CREATE TABLE orders (
    order_id     VARCHAR2(255) PRIMARY KEY,
    user_id      VARCHAR2(255) NOT NULL,
    total_price  NUMBER(10,2) NOT NULL,
    status       VARCHAR2(255) NOT NULL,
    purchased_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
)
/

CREATE TABLE order_items (
    order_item_id     VARCHAR2(255) PRIMARY KEY,
    order_id          VARCHAR2(255) NOT NULL,
    book_id           VARCHAR2(255) NOT NULL,
    quantity          NUMBER(10) NOT NULL,
    price_at_purchase NUMBER(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
)
/

CREATE TABLE cart_items (
    cart_item_id VARCHAR2(255) PRIMARY KEY,
    user_id      VARCHAR2(255) NOT NULL,
    book_id      VARCHAR2(255) NOT NULL,
    quantity     NUMBER(10) NOT NULL,
    added_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
)
/

CREATE TABLE marketplace_listings (
    listing_id     VARCHAR2(255) PRIMARY KEY,
    seller_id      VARCHAR2(255) NOT NULL,
    book_id        VARCHAR2(255) NOT NULL,
    item_condition VARCHAR2(255) NOT NULL,
    price          NUMBER(10,2) NOT NULL,
    listed_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    status         VARCHAR2(255) NOT NULL,
    FOREIGN KEY (seller_id) REFERENCES users(user_id),
    FOREIGN KEY (book_id) REFERENCES books(book_id)
)
/

CREATE INDEX idx_order_items_order ON order_items(order_id)
/
CREATE INDEX idx_order_items_book  ON order_items(book_id)
/
CREATE INDEX idx_orders_user       ON orders(user_id)
/
CREATE INDEX idx_cart_user         ON cart_items(user_id)
/
CREATE INDEX idx_listings_book     ON marketplace_listings(book_id)
/
