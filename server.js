import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

const DB_PATH = "./db.json";

function lerBanco() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ usuarios: [] }, null, 2));
    }

    const dados = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(dados || '{"usuarios":[]}');
}

function salvarBanco(dados) {
    fs.writeFileSync(DB_PATH, JSON.stringify(dados, null, 2));
}

function valorPlano(plano) {
    if (plano === "basico") return 19.90;
    if (plano === "profissional") return 39.90;
    if (plano === "premium") return 69.90;
    return 19.90;
}

app.get("/", (req, res) => {
    res.json({ status: "Servidor Promotor de Elite rodando" });
});

app.post("/criar-pix", async (req, res) => {
    try {
        const { nome, contato, funcao, plano, email } = req.body;

        if (!ACCESS_TOKEN) {
            return res.status(500).json({ erro: "Access Token do Mercado Pago não configurado no .env." });
        }

        if (!nome || !contato || !funcao || !plano) {
            return res.status(400).json({ erro: "Nome, contato, função e plano são obrigatórios." });
        }

        const valor = valorPlano(plano);

        const pagamento = {
            transaction_amount: valor,
            description: `Promotor de Elite - ${plano}`,
            payment_method_id: "pix",
            payer: {
                email: email || `cliente${Date.now()}@promotorelite.com.br`,
                first_name: nome
            },
            external_reference: contato
        };

        if (PUBLIC_BASE_URL) {
            pagamento.notification_url = `${PUBLIC_BASE_URL}/webhook`;
        }

        const resposta = await fetch("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${ACCESS_TOKEN}`,
                "X-Idempotency-Key": crypto.randomUUID()
            },
            body: JSON.stringify(pagamento)
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            return res.status(400).json({ erro: "Erro ao criar pagamento no Mercado Pago.", detalhe: dados });
        }

        const banco = lerBanco();
        const existente = banco.usuarios.find(item => item.contato === contato);

        const registro = {
            nome,
            contato,
            funcao,
            plano,
            valor,
            payment_id: dados.id,
            status: dados.status || "pending",
            acesso: false,
            atualizado_em: new Date().toISOString()
        };

        if (existente) {
            Object.assign(existente, registro);
        } else {
            banco.usuarios.push({ ...registro, criado_em: new Date().toISOString() });
        }

        salvarBanco(banco);

        const transacao = dados.point_of_interaction?.transaction_data || {};

        res.json({
            payment_id: dados.id,
            status: dados.status,
            qr_code: transacao.qr_code,
            qr_code_base64: transacao.qr_code_base64,
            ticket_url: transacao.ticket_url
        });

    } catch (erro) {
        res.status(500).json({ erro: "Erro interno ao criar Pix.", detalhe: erro.message });
    }
});

app.post("/webhook", async (req, res) => {
    try {
        const paymentId = req.body?.data?.id || req.query?.id;

        if (!paymentId) return res.sendStatus(200);

        const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${ACCESS_TOKEN}` }
        });

        const pagamento = await resposta.json();
        const banco = lerBanco();

        const usuario = banco.usuarios.find(item => String(item.payment_id) === String(paymentId));

        if (usuario) {
            usuario.status = pagamento.status;
            usuario.status_detail = pagamento.status_detail;
            usuario.atualizado_em = new Date().toISOString();

            if (pagamento.status === "approved") {
                usuario.acesso = true;
                usuario.pago_em = new Date().toISOString();
            }

            salvarBanco(banco);
        }

        res.sendStatus(200);
    } catch (erro) {
        console.error("Erro no webhook:", erro);
        res.sendStatus(500);
    }
});

app.get("/verificar-acesso/:contato", (req, res) => {
    const { contato } = req.params;
    const banco = lerBanco();

    const usuario = banco.usuarios.find(item => item.contato === contato && item.status === "approved");

    if (usuario) return res.json({ acesso: true, usuario });
    res.json({ acesso: false });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
