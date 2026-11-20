-- Starting color chart (all TPU 95A): every filament color JUP LIFE sells (Nov 20, 2026). Safe to re-run: existing rows are kept.
INSERT OR IGNORE INTO filaments (id,name,hex,used_in,grp,sort,clear,full,partial_g,material,brand,note) VALUES
  ('pumpkin','Pumpkin','#E8731E','Pop · Fall tray','Pop',1,0,NULL,NULL,'TPU','',''),
  ('cinnamon','Cinnamon','#A0522D','Pop · Fall tray','Pop',2,0,NULL,NULL,'TPU','',''),
  ('cranberry','Cranberry','#9B1B30','Pop · Fall tray','Pop',3,0,NULL,NULL,'TPU','',''),
  ('maple','Maple','#C8862A','Pop · Fall tray','Pop',4,0,NULL,NULL,'TPU','',''),
  ('rhubarb','Rhubarb','#C93A5B','Pop · Fall tray','Pop',5,0,NULL,NULL,'TPU','',''),
  ('sunflower','Sunflower','#F6C21C','Pop + Flower (Sunflower)','Pop',6,0,NULL,NULL,'TPU','','Used by two products. Watch this one.'),
  ('blueberry','Blueberry','#3F5BB8','Pop · Summer tray','Pop',7,0,NULL,NULL,'TPU','',''),
  ('peach','Peach','#FFB07C','Pop + Flower (Hibiscus Peach)','Pop',8,0,NULL,NULL,'TPU','','Used by two products. Watch this one.'),
  ('key-lime','Key Lime','#A8D94A','Pop · Summer tray','Pop',9,0,NULL,NULL,'TPU','',''),
  ('watermelon','Watermelon','#F2546B','Pop · Summer tray','Pop',10,0,NULL,NULL,'TPU','',''),
  ('coconut','Coconut (clear)','#F4EFE3','Pop','Pop',11,1,NULL,NULL,'TPU','','Clear. If it''s the same spool as Frost, count it here and leave Frost empty.'),
  ('sage','Sage','#9CAF88','Flower (Hibiscus Sage)','Flower',101,0,NULL,NULL,'TPU','',''),
  ('cream','Cream','#EFE6D2','Flower (Hibiscus Cream)','Flower',102,0,NULL,NULL,'TPU','',''),
  ('ruby','Ruby','#9B111E','Flower (Hibiscus Ruby)','Flower',103,0,NULL,NULL,'TPU','',''),
  ('frost','Frost (clear)','#E8EEF2','Flower (Hibiscus Frost)','Flower',104,1,NULL,NULL,'TPU','','Clear. Same spool as Coconut?'),
  ('sea-glass','Sea Glass','#9FD8C6','Coastal','Coastal',201,0,NULL,NULL,'TPU','',''),
  ('shell','Shell','#E0D5C1','Coastal','Coastal',202,0,NULL,NULL,'TPU','',''),
  ('dunes','Dunes','#D9B25F','Coastal','Coastal',203,0,NULL,NULL,'TPU','',''),
  ('red-mangrove','Red Mangrove','#206030','Coastal','Coastal',204,0,NULL,NULL,'TPU','',''),
  ('banyan','Banyan','#3E7D3A','Coastal','Coastal',205,0,NULL,NULL,'TPU','',''),
  ('sea-turtle','Sea Turtle','#0F7C82','Coastal','Coastal',206,0,NULL,NULL,'TPU','',''),
  ('case','Case filament','','Pop + Flower cases','Other',301,0,NULL,NULL,'TPU','','Count your case filament here, or use + Add color to add each case color separately.');

-- SUNLU High Speed TPU 95A 10 kg pack: one 1 kg spool per color, on the shelf Nov 20, 2026. Temps from sunlu.com.
INSERT OR IGNORE INTO filaments (id,name,hex,used_in,grp,sort,clear,full,partial_g,material,maker,brand,nozzle,bed,note) VALUES
  ('sunlu-black','Black','#1E1E1E','SUNLU TPU 95A','Stock',1,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Black','190-210','50-60',''),
  ('sunlu-white','White','#F5F5F2','SUNLU TPU 95A','Stock',2,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, White','190-210','50-60',''),
  ('sunlu-grey','Grey','#808285','SUNLU TPU 95A','Stock',3,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Grey','190-210','50-60',''),
  ('sunlu-red','Red','#D7262E','SUNLU TPU 95A','Stock',4,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Red','190-210','50-60',''),
  ('sunlu-orange','Orange','#EE6A1F','SUNLU TPU 95A','Stock',5,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Orange','190-210','50-60',''),
  ('sunlu-light-blue','Light Blue','#1F8FD6','SUNLU TPU 95A','Stock',6,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Light Blue','190-210','50-60',''),
  ('sunlu-green','Green','#3CC54A','SUNLU TPU 95A','Stock',7,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Green','190-210','50-60',''),
  ('sunlu-blue','Blue','#1F3FD8','SUNLU TPU 95A','Stock',8,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Blue','190-210','50-60',''),
  ('sunlu-purple','Purple','#A040C0','SUNLU TPU 95A','Stock',9,0,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Purple','190-210','50-60',''),
  ('sunlu-clear','Clear','#D8D8D4','SUNLU TPU 95A','Stock',10,1,1,0,'TPU','SUNLU','SUNLU High Speed TPU 95A, Clear','190-210','50-60','Clear spool. Coconut and Frost may print from this.');
