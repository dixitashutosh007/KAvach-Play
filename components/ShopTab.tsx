"use client";
import { authedFetch } from "@/lib/authed-fetch";

import React, { useState, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/components/AuthProvider";
import {
  ShoppingBag,
  Tag,
  Sliders,
  Plus,
  Trash2,
  User,
  CreditCard,
  Layers,
  Activity,
  CheckCircle,
  Clock,
  AlertTriangle,
  Edit,
  Sparkles,
  Package,
  X,
  UserPlus,
  Copy,
  Check,
  FileText,
  Share2,
} from "lucide-react";
import { Merchandise, MerchOrder, MerchCustomField, MerchCustomFieldOption } from "@/lib/types";

export function ShopTab({
  store,
  persona,
  isAdmin,
}: {
  store: ReturnType<typeof useStore>;
  persona: "player" | "admin";
  isAdmin: boolean;
}) {
  const { user } = useAuth();
  const [view, setView] = useState<"catalog" | "history" | "global-list" | "admin">("catalog");
  const [showReportModal, setShowReportModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<"merchandise" | "orders">("merchandise");

  // Local states for Admin merchandise creation
  const [showAddMerch, setShowAddMerch] = useState(false);
  const [editingMerch, setEditingMerch] = useState<Merchandise | null>(null);
  
  const [merchName, setMerchName] = useState("");
  const [merchCategory, setMerchCategory] = useState<"Jersey" | "Pant" | "Jacket" | "Sweater" | "Cap" | "Cricket Gears" | "Stickers" | "Others">("Jersey");
  const [merchDescription, setMerchDescription] = useState("");
  const [merchBasePrice, setMerchBasePrice] = useState(0);
  const [merchSizes, setMerchSizes] = useState("");
  const [merchSpecs, setMerchSpecs] = useState("");
  const [merchMinQty, setMerchMinQty] = useState(10);
  const [merchStatus, setMerchStatus] = useState<"Accepting Orders" | "Not Accepting Orders">("Accepting Orders");
  const [merchIsHidden, setMerchIsHidden] = useState(false);
  const [merchRequirePlayerDetails, setMerchRequirePlayerDetails] = useState(false);
  const [merchCustomFields, setMerchCustomFields] = useState<MerchCustomField[]>([]);

  useEffect(() => {
    // Dynamically load Razorpay SDK
    if (!document.getElementById("razorpay-checkout-js")) {
      const script = document.createElement("script");
      script.id = "razorpay-checkout-js";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);
  const [enableCustomAttributes, setEnableCustomAttributes] = useState(true);

  // Local state for Player order customization modal
  const [selectedMerch, setSelectedMerch] = useState<Merchandise | null>(null);
  const [orderSize, setOrderSize] = useState("");
  const [orderSpec, setOrderSpec] = useState("");
  const [orderCustomSelections, setOrderCustomSelections] = useState<Record<string, string>>({});
  const [customJerseyName, setCustomJerseyName] = useState("");
  const [customJerseyNumber, setCustomJerseyNumber] = useState("");
  const [isOrdering, setIsOrdering] = useState(false);

  // Local state for Admin Edit Order modal
  const [editingOrder, setEditingOrder] = useState<MerchOrder | null>(null);
  const [editOrderDraft, setEditOrderDraft] = useState<Partial<MerchOrder>>({});
  const [editOrderCustomDraft, setEditOrderCustomDraft] = useState<Record<string, string>>({});
  const [isSavingEditOrder, setIsSavingEditOrder] = useState(false);

  // Local state for Admin Manual Order
  const [showManualOrder, setShowManualOrder] = useState(false);
  const [isSavingManualOrder, setIsSavingManualOrder] = useState(false);
  const [manualPlayerId, setManualPlayerId] = useState("");
  const [manualMerchId, setManualMerchId] = useState("");
  const [manualSize, setManualSize] = useState("");
  const [manualSpec, setManualSpec] = useState("");
  const [manualCustomSelections, setManualCustomSelections] = useState<Record<string, string>>({});
  const [manualJerseyName, setManualJerseyName] = useState("");
  const [manualJerseyNumber, setManualJerseyNumber] = useState("");
  const [manualPrice, setManualPrice] = useState(0);
  const [manualPaidStatus, setManualPaidStatus] = useState<"Paid" | "Unpaid">("Paid");

  // The useEffect that auto-populated default custom attributes based on category 
  // has been removed. Admin will create custom attributes manually as needed.

  // Get active player profile for current logged-in user
  const playerProfile = store.players.find((p) => p.authUid === user?.uid);
  const userProfile = store.appUsers.find((u) => u.id === user?.uid);

  const defaultJerseyName = customJerseyName || playerProfile?.jerseyName || userProfile?.name || "";
  const defaultJerseyNumber = customJerseyNumber || playerProfile?.jerseyNumber || userProfile?.jerseyNumber || "";
  const defaultChestSize = orderSize || playerProfile?.chestSize || userProfile?.chestSize || "";

  // Group orders by merch item to calculate MOQ progress
  const getOrdersForMerch = (merchId: string) => {
    return store.merchOrders.filter((o) => o.merchId === merchId);
  };

  const getPaidOrdersCount = (merchId: string) => {
    return store.merchOrders.filter((o) => o.merchId === merchId && o.paymentStatus === "Paid").length;
  };

  const handleCreateOrUpdateMerchandise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchName.trim() || merchBasePrice <= 0) {
      alert("Please fill in all required fields and set a valid price.");
      return;
    }

    const payload = {
      name: merchName,
      description: merchDescription,
      category: merchCategory,
      basePrice: Number(merchBasePrice),
      sizes: enableCustomAttributes ? [] : merchSizes.split(",").map((s) => s.trim()).filter(Boolean),
      specs: enableCustomAttributes ? [] : merchSpecs.split(",").map((s) => s.trim()).filter(Boolean),
      customFields: enableCustomAttributes ? merchCustomFields : [],
      minOrderQuantity: Number(merchMinQty) || 1,
      status: merchStatus,
      isHidden: merchIsHidden,
      requirePlayerDetails: merchRequirePlayerDetails,
    };

    try {
      if (editingMerch) {
        await store.updateMerchandise(editingMerch.id, payload);
        alert("Merchandise updated successfully!");
      } else {
        await store.addMerchandise(payload);
        alert("Merchandise added successfully!");
      }
      resetMerchForm();
    } catch (err) {
      alert("An error occurred. Please try again.");
    }
  };

  const resetMerchForm = () => {
    setMerchName("");
    setMerchCategory("Jersey");
    setMerchDescription("");
    setMerchBasePrice(0);
    setMerchSizes("");
    setMerchSpecs("");
    setMerchCustomFields([]);
    setEnableCustomAttributes(false);
    setMerchMinQty(10);
    setMerchStatus("Accepting Orders");
    setMerchIsHidden(false);
    setMerchRequirePlayerDetails(false);
    setShowAddMerch(false);
    setEditingMerch(null);
  };

  const handleEditMerchandise = (merch: Merchandise) => {
    setEditingMerch(merch);
    setMerchName(merch.name);
    setMerchCategory(merch.category);
    setMerchDescription(merch.description || "");
    setMerchBasePrice(merch.basePrice);
    
    // Migrate legacy if no custom fields
    let initialCustomFields = merch.customFields || [];
    if (initialCustomFields.length === 0 && (merch.sizes?.length > 0 || merch.specs?.length > 0)) {
      if (merch.sizes?.length > 0) {
        initialCustomFields.push({
          name: "Size",
          options: merch.sizes.map(s => ({ value: s, priceModifierType: "None" }))
        });
      }
      if (merch.specs?.length > 0) {
        initialCustomFields.push({
          name: "Specification",
          options: merch.specs.map(s => ({ value: s, priceModifierType: "None" }))
        });
      }
    }
    setMerchCustomFields(initialCustomFields);
    setEnableCustomAttributes(initialCustomFields.length > 0);

    setMerchSizes(merch.sizes?.join(", ") || "");
    setMerchSpecs(merch.specs?.join(", ") || "");
    setMerchMinQty(merch.minOrderQuantity);
    setMerchStatus(merch.status);
    setMerchIsHidden(merch.isHidden || false);
    setMerchRequirePlayerDetails(merch.requirePlayerDetails || false);
    setShowAddMerch(true);
  };

  const handleAddCustomField = () => {
    setMerchCustomFields([...merchCustomFields, { name: "", options: [] }]);
  };

  const handleUpdateCustomFieldName = (index: number, name: string) => {
    const newFields = [...merchCustomFields];
    newFields[index].name = name;
    setMerchCustomFields(newFields);
  };

  const handleRemoveCustomField = (index: number) => {
    const newFields = [...merchCustomFields];
    newFields.splice(index, 1);
    setMerchCustomFields(newFields);
  };

  const handleAddCustomFieldOption = (fieldIndex: number) => {
    const newFields = [...merchCustomFields];
    newFields[fieldIndex].options.push({ value: "", priceModifierType: "None" });
    setMerchCustomFields(newFields);
  };

  const handleUpdateCustomFieldOption = (fieldIndex: number, optionIndex: number, optionData: Partial<MerchCustomFieldOption>) => {
    const newFields = [...merchCustomFields];
    newFields[fieldIndex].options[optionIndex] = { ...newFields[fieldIndex].options[optionIndex], ...optionData };
    setMerchCustomFields(newFields);
  };

  const handleRemoveCustomFieldOption = (fieldIndex: number, optionIndex: number) => {
    const newFields = [...merchCustomFields];
    newFields[fieldIndex].options.splice(optionIndex, 1);
    setMerchCustomFields(newFields);
  };

  const handleDeleteMerchandise = async (id: string) => {
    if (confirm("Are you sure you want to delete this merchandise item? This will not delete past orders.")) {
      await store.deleteMerchandise(id);
    }
  };

  const openOrderModal = (merch: Merchandise) => {
    setSelectedMerch(merch);
    // Pre-fill size from the player's saved chestSize when it's one of the
    // available options, otherwise fall back to the first size. User can
    // still change it in the modal.
    const savedSize = playerProfile?.chestSize || userProfile?.chestSize || "";
    const sizeMatches = savedSize && merch.sizes?.includes(savedSize);
    setOrderSize(sizeMatches ? savedSize : (merch.sizes?.[0] || ""));
    setOrderSpec(merch.specs?.[0] || "");

    const initialSelections: Record<string, string> = {};
    if (merch.customFields) {
      merch.customFields.forEach(field => {
        let defaultVal = field.options[0]?.value || "";
        const lowerName = field.name.toLowerCase();
        
        if (lowerName.includes("chest") && (playerProfile?.chestSize || userProfile?.chestSize)) {
          const matched = field.options.find(o => o.value === (playerProfile?.chestSize || userProfile?.chestSize));
          if (matched) defaultVal = matched.value;
        } else if (lowerName.includes("waist") && (playerProfile?.waistSize || userProfile?.waistSize)) {
          const matched = field.options.find(o => o.value === (playerProfile?.waistSize || userProfile?.waistSize));
          if (matched) defaultVal = matched.value;
        }
        
        initialSelections[field.name] = defaultVal;
      });
    }
    setOrderCustomSelections(initialSelections);

    setCustomJerseyName(playerProfile?.jerseyName || userProfile?.name || "");
    setCustomJerseyNumber(playerProfile?.jerseyNumber || userProfile?.jerseyNumber || "");
  };

  const handlePlaceOrder = async () => {
    if (!selectedMerch) return;

    let customPriceAdditions = 0;
    if (selectedMerch.customFields && selectedMerch.customFields.length > 0) {
      for (const field of selectedMerch.customFields) {
        const selectedVal = orderCustomSelections[field.name];
        if (!selectedVal) {
          alert(`Please select an option for ${field.name}.`);
          return;
        }
        const opt = field.options.find(o => o.value === selectedVal);
        if (opt && opt.priceModifierType === "Add" && opt.priceModifierValue) {
          customPriceAdditions += opt.priceModifierValue;
        }
      }
    } else if (selectedMerch.sizes?.length > 0 && !orderSize) {
      alert("Please select a size.");
      return;
    }

    const hasJerseyDetails = selectedMerch.category === "Jersey" || selectedMerch.requirePlayerDetails;

    if (hasJerseyDetails) {
      if (!customJerseyName.trim()) {
        alert("Please enter a name to print on the jersey.");
        return;
      }
      if (!customJerseyNumber.trim()) {
        alert("Please enter a jersey number.");
        return;
      }
      if (customJerseyNumber.trim() === "10") {
        alert("Jersey Number 10 is reserved and blocked! Please choose another number.");
        return;
      }
    }

    setIsOrdering(true);

    try {
      const finalPrice = selectedMerch.basePrice + customPriceAdditions;

      if (finalPrice > 0) {
        const keyId =
          store.appConfig?.razorpayKeyId ||
          process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

        if (!keyId) {
          alert("Razorpay keys are missing (Settings -> Payment Gateway)");
          setIsOrdering(false);
          return;
        }

        const hasJerseyDetails = selectedMerch.category === "Jersey" || selectedMerch.requirePlayerDetails;

        const orderPayload = {
          playerId: playerProfile?.id || user?.uid || "unknown",
          playerName: playerProfile?.name || userProfile?.name || "Anonymous Player",
          merchId: selectedMerch.id,
          merchName: selectedMerch.name,
          size: orderSize,
          spec: orderSpec || undefined,
          customSelections: Object.keys(orderCustomSelections).length > 0 ? orderCustomSelections : undefined,
          customPriceAdditions: customPriceAdditions > 0 ? customPriceAdditions : undefined,
          jerseyName: hasJerseyDetails ? customJerseyName : undefined,
          jerseyNumber: hasJerseyDetails ? customJerseyNumber : undefined,
          price: finalPrice,
          paymentStatus: "Paid",
          deliveryStatus: "Processing" as const,
        };

        const res = await fetch("/api/razorpay/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: finalPrice,
            currency: "INR",
            intentData: {
              type: "merch_order",
              orderPayload: orderPayload
            }
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to create Razorpay order");
        }

        const orderData = await res.json();

        const options = {
          key: keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: "Club Merchandise",
          description: `Order: ${selectedMerch.name}`,
          order_id: orderData.id,
          handler: async function (response: any) {
            await finalizeOrderPlacement(finalPrice, customPriceAdditions);
          },
          prefill: {
            name: playerProfile?.name || userProfile?.name || "Player",
            email: user?.email || playerProfile?.email || userProfile?.email || "",
            contact: playerProfile?.mobile || userProfile?.mobile || "",
          },
          theme: {
            color: "#FF3366", // Accent color
          },
          modal: {
            ondismiss: function () {
              setIsOrdering(false);
              alert("Payment was cancelled or closed.");
            },
          },
        };

        const paymentObject = new (window as any).Razorpay(options);
        paymentObject.on("payment.failed", function (response: any) {
          setIsOrdering(false);
          alert("Payment failed: " + response.error.description);
        });
        paymentObject.open();
      } else {
        await finalizeOrderPlacement(finalPrice, customPriceAdditions);
      }
    } catch (err) {
      alert("Order failed. Please try again.");
      setIsOrdering(false);
    }
  };

  const finalizeOrderPlacement = async (finalPrice: number, customPriceAdditions: number) => {
    if (!selectedMerch) return;
    try {
      setIsOrdering(true);
      const currentPaidCount = getPaidOrdersCount(selectedMerch.id);
      const newPaidCount = currentPaidCount + 1;
      const reachedMoq = newPaidCount >= selectedMerch.minOrderQuantity;
      const hasJerseyDetails = selectedMerch.category === "Jersey" || selectedMerch.requirePlayerDetails;

      // Extract the effective size from either the top-level size dropdown
      // OR from a chest/size custom field. This ensures ord.size is always
      // populated so Club Orders shows it. Also picks up waist for profile
      // sync below.
      let effectiveSize = orderSize;
      let effectiveWaist = "";
      Object.entries(orderCustomSelections).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (!value) return;
        if (!effectiveSize && (lowerKey.includes("chest") || lowerKey === "size")) {
          effectiveSize = value;
        }
        if (lowerKey.includes("waist")) {
          effectiveWaist = value;
        }
      });

      const orderPayload = {
        playerId: playerProfile?.id || user?.uid || "unknown",
        playerName: playerProfile?.name || userProfile?.name || "Anonymous Player",
        merchId: selectedMerch.id,
        merchName: selectedMerch.name,
        size: effectiveSize,
        spec: orderSpec || undefined,
        customSelections: Object.keys(orderCustomSelections).length > 0 ? orderCustomSelections : undefined,
        customPriceAdditions: customPriceAdditions > 0 ? customPriceAdditions : undefined,
        jerseyName: hasJerseyDetails ? customJerseyName : undefined,
        jerseyNumber: hasJerseyDetails ? customJerseyNumber : undefined,
        price: finalPrice,
        paymentStatus: "Paid" as const, // Upfront collection
        orderStatus: (reachedMoq ? "Ready to Place Order" : "Awaiting Min Order Qnty") as any,
      };

      const orderId = await store.addMerchOrder(orderPayload);

      // Silently sync the player profile with the details they used for this
      // order (size, waist, jersey name, jersey number). Previously this was
      // a confirm() prompt that most users dismissed, leaving profiles stale.
      const updatePayload: any = {};
      if (effectiveSize) updatePayload.chestSize = effectiveSize;
      if (effectiveWaist) updatePayload.waistSize = effectiveWaist;
      if (hasJerseyDetails) {
        if (customJerseyName) updatePayload.jerseyName = customJerseyName;
        if (customJerseyNumber) updatePayload.jerseyNumber = customJerseyNumber;
      }
      if (Object.keys(updatePayload).length > 0) {
        try {
          if (playerProfile) {
            await store.updatePlayer(playerProfile.id, updatePayload);
          }
          if (userProfile) {
            await store.updateAppUserProfile(user?.uid || "", { ...userProfile, ...updatePayload });
          }
        } catch (e) {
          console.warn("Profile sync after order failed (order was still placed):", e);
        }
      }

      // Update sister orders status if we just reached the MOQ
      if (reachedMoq) {
        const sisterOrders = store.merchOrders.filter((o) => o.merchId === selectedMerch.id && o.orderStatus === "Awaiting Min Order Qnty");
        for (const sister of sisterOrders) {
          await store.updateMerchOrder(sister.id, { orderStatus: "Ready to Place Order" });
        }
      }

      // Send emails
      try {
        const playerEmail = userProfile?.email || playerProfile?.email || user?.email;
        const adminUsers = store.appUsers.filter((u) => u.role === "admin" || u.isFinanceAdmin);
        const adminEmails = adminUsers.map((u) => u.email).filter(Boolean);
        
        const emailsToSend = [];
        if (playerEmail) emailsToSend.push(playerEmail);
        emailsToSend.push(...adminEmails);

        if (emailsToSend.length > 0) {
          await authedFetch("/api/email/send", {
            method: "POST",
            body: JSON.stringify({
              to: [...new Set(emailsToSend)], // Deduplicate
              subject: `Shop Order Placed: ${selectedMerch.name}`,
              text: `A new shop order has been placed.\n\nPlayer: ${orderPayload.playerName}\nItem: ${selectedMerch.name}\nAmount: ₹${finalPrice}\n\nThank you!`,
              config: store.appConfig,
            }),
          });
        }
      } catch (emailErr) {
        console.error("Failed to send order emails", emailErr);
      }

      alert("Thank you! Order placed successfully and payment recorded.");
      setSelectedMerch(null);
    } catch (err) {
      alert("Order recording failed. Please contact admin.");
    } finally {
      setIsOrdering(false);
    }
  };

  const handleAddManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard against double-tap / slow-network submissions that would
    // otherwise write two Firestore docs with different random UUIDs and
    // show up as duplicate rows in Club Orders.
    if (isSavingManualOrder) return;

    const selectedProduct = store.merchandises.find((m) => m.id === manualMerchId);
    if (!selectedProduct) return;

    let customPriceAdditions = 0;
    if (selectedProduct.customFields && selectedProduct.customFields.length > 0) {
      for (const field of selectedProduct.customFields) {
        const selectedVal = manualCustomSelections[field.name];
        if (!selectedVal) {
          alert(`Please choose a ${field.name}.`);
          return;
        }
        const opt = field.options.find(o => o.value === selectedVal);
        if (opt && opt.priceModifierType === "Add" && opt.priceModifierValue) {
          customPriceAdditions += opt.priceModifierValue;
        }
      }
    }
    if (!manualPlayerId || !manualMerchId) {
      alert("Please choose a player and a merchandise item.");
      return;
    }

    if (!selectedProduct.customFields || selectedProduct.customFields.length === 0) {
      if (selectedProduct.sizes && selectedProduct.sizes.length > 0 && !manualSize) {
        alert("Please choose a size.");
        return;
      }
    }

    const selectedPlayer = store.players.find((p) => p.id === manualPlayerId);
    if (!selectedPlayer) return;

    if (selectedProduct.category === "Jersey" && manualJerseyNumber === "10") {
      alert("Jersey number 10 is blocked and cannot be used.");
      return;
    }

    setIsSavingManualOrder(true);
    try {
      const currentPaidCount = getPaidOrdersCount(selectedProduct.id);
      const newPaidCount = currentPaidCount + (manualPaidStatus === "Paid" ? 1 : 0);
      const reachedMoq = newPaidCount >= selectedProduct.minOrderQuantity;

      const baseOrManualPrice = Number(manualPrice) || selectedProduct.basePrice;

      const orderPayload = {
        playerId: selectedPlayer.id,
        playerName: selectedPlayer.name,
        merchId: selectedProduct.id,
        merchName: selectedProduct.name,
        size: manualSize,
        spec: manualSpec || undefined,
        customSelections: Object.keys(manualCustomSelections).length > 0 ? manualCustomSelections : undefined,
        customPriceAdditions: customPriceAdditions > 0 ? customPriceAdditions : undefined,
        jerseyName: selectedProduct.category === "Jersey" ? (manualJerseyName || selectedPlayer.name) : undefined,
        jerseyNumber: selectedProduct.category === "Jersey" ? (manualJerseyNumber || selectedPlayer.jerseyNumber) : undefined,
        price: baseOrManualPrice + customPriceAdditions,
        paymentStatus: manualPaidStatus,
        orderStatus: (reachedMoq ? "Ready to Place Order" : "Awaiting Min Order Qnty") as any,
        isManual: true,
      };

      await store.addMerchOrder(orderPayload);

      if (reachedMoq && manualPaidStatus === "Paid") {
        const sisterOrders = store.merchOrders.filter((o) => o.merchId === selectedProduct.id && o.orderStatus === "Awaiting Min Order Qnty");
        for (const sister of sisterOrders) {
          await store.updateMerchOrder(sister.id, { orderStatus: "Ready to Place Order" });
        }
      }

      // Send emails
      try {
        const adminUsers = store.appUsers.filter((u) => u.role === "admin" || u.isFinanceAdmin);
        const adminEmails = adminUsers.map((u) => u.email).filter(Boolean);
        const emailsToSend = [...adminEmails];

        if (emailsToSend.length > 0) {
          await authedFetch("/api/email/send", {
            method: "POST",
            body: JSON.stringify({
              to: [...new Set(emailsToSend)],
              subject: `Manual Shop Order Placed: ${selectedProduct.name}`,
              text: `A manual shop order has been created.\n\nPlayer: ${orderPayload.playerName}\nItem: ${selectedProduct.name}\nAmount: ₹${orderPayload.price}\nPayment Status: ${manualPaidStatus}\n\nThank you!`,
              config: store.appConfig,
            }),
          });
        }
      } catch (emailErr) {
        console.error("Failed to send order emails", emailErr);
      }

      alert("Manual order created successfully!");
      setShowManualOrder(false);
      setManualPlayerId("");
      setManualMerchId("");
      setManualSize("");
      setManualSpec("");
      setManualCustomSelections({});
      setManualJerseyName("");
      setManualJerseyNumber("");
      setManualPrice(0);
    } catch (err) {
      alert("Failed to create manual order.");
    } finally {
      setIsSavingManualOrder(false);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: any) => {
    try {
      await store.updateMerchOrder(orderId, { orderStatus: status });
      alert(`Order status updated to "${status}"`);
    } catch (err) {
      alert("Failed to update status.");
    }
  };

  const handleDeleteOrder = async (order: MerchOrder) => {
    if (
      !window.confirm(
        `Delete this order for ${order.playerName} (${order.merchName})?\n\n` +
          `This removes the row from Club Orders permanently. If it was already paid, the payment record on Razorpay is not affected.`,
      )
    )
      return;
    try {
      await store.deleteMerchOrder(order.id);
    } catch (err) {
      alert("Failed to delete order.");
    }
  };

  const openEditOrder = (order: MerchOrder) => {
    setEditingOrder(order);
    setEditOrderDraft({
      size: order.size || "",
      spec: order.spec || "",
      jerseyName: order.jerseyName || "",
      jerseyNumber: order.jerseyNumber || "",
      price: order.price,
      paymentStatus: order.paymentStatus,
    });
    setEditOrderCustomDraft({ ...(order.customSelections || {}) });
  };

  const closeEditOrder = () => {
    setEditingOrder(null);
    setEditOrderDraft({});
    setEditOrderCustomDraft({});
    setIsSavingEditOrder(false);
  };

  const handleSaveEditOrder = async () => {
    if (!editingOrder || isSavingEditOrder) return;
    setIsSavingEditOrder(true);
    try {
      const patch: Partial<MerchOrder> = {
        size: editOrderDraft.size ?? "",
        spec: editOrderDraft.spec || undefined,
        jerseyName: editOrderDraft.jerseyName || undefined,
        jerseyNumber: editOrderDraft.jerseyNumber || undefined,
        price:
          typeof editOrderDraft.price === "number"
            ? editOrderDraft.price
            : Number(editOrderDraft.price) || editingOrder.price,
        paymentStatus: editOrderDraft.paymentStatus || editingOrder.paymentStatus,
        customSelections:
          Object.keys(editOrderCustomDraft).length > 0 ? editOrderCustomDraft : undefined,
      };
      await store.updateMerchOrder(editingOrder.id, patch);
      closeEditOrder();
    } catch (err) {
      alert("Failed to update order.");
      setIsSavingEditOrder(false);
    }
  };

  const handleUpdateOrderPaymentStatus = async (orderId: string, status: "Paid" | "Unpaid") => {
    try {
      await store.updateMerchOrder(orderId, { paymentStatus: status });
      alert(`Payment status updated to "${status}"`);
    } catch (err) {
      alert("Failed to update payment status.");
    }
  };

  const getWhatsAppReportText = () => {
    let report = `*KAvach Merc Order*\n----\n`;
    
    store.merchOrders.forEach((o, index) => {
      const jNumber = o.jerseyNumber ? `#${o.jerseyNumber}` : "#—";
      const specText = o.spec || "Standard";
      report += `${index + 1}. ${o.playerName} | ${jNumber} | ${o.size || "N/A"} | ${specText}\n`;
    });

    return report;
  };

  const handleCopyWhatsAppReport = () => {
    try {
      const text = getWhatsAppReportText();
      navigator.clipboard.writeText(text);
      setIsCopied(true);
      alert("WhatsApp formatted vendor report copied to clipboard!");
    } catch (err) {
      alert("Could not copy automatically. Please copy the text in the preview box manually.");
    }
  };

  const myOrders = store.merchOrders.filter((o) => o.playerId === playerProfile?.id || o.playerId === user?.uid);

  return (
    <div className="space-y-6" id="shop-tab-container">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold uppercase tracking-widest text-white flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-accent" /> Shop
          </h2>
          <p className="text-xs text-white/60">
            Order official team jerseys, pants, and gear. Awaiting vendor minimum quantity order goals.
          </p>
        </div>

        {/* View Toggle — wraps on narrow screens so all pills stay visible
            instead of the last one (Administration) sliding off the right. */}
        <div className="flex flex-wrap gap-1 bg-black/20 p-1 rounded-xl border border-glass-border w-full lg:w-auto">
          <button
            onClick={() => setView("catalog")}
            className={`flex-1 lg:flex-none min-w-[7rem] px-3 sm:px-4 py-2 rounded-lg text-[11px] sm:text-xs font-bold uppercase tracking-wider transition whitespace-nowrap ${
              view === "catalog" ? "bg-accent text-black shadow-lg" : "text-white/60 hover:text-white"
            }`}
          >
            Store Menu
          </button>
          <button
            onClick={() => setView("history")}
            className={`flex-1 lg:flex-none min-w-[7rem] px-3 sm:px-4 py-2 rounded-lg text-[11px] sm:text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
              view === "history" ? "bg-accent text-black shadow-lg" : "text-white/60 hover:text-white"
            }`}
          >
            My Orders ({myOrders.length})
          </button>
          <button
            onClick={() => setView("global-list")}
            className={`flex-1 lg:flex-none min-w-[7rem] px-3 sm:px-4 py-2 rounded-lg text-[11px] sm:text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
              view === "global-list" ? "bg-accent text-black shadow-lg" : "text-white/60 hover:text-white"
            }`}
          >
            Club Orders ({store.merchOrders.length})
          </button>
          {isAdmin && (
            <button
              onClick={() => setView("admin")}
              className={`flex-1 lg:flex-none min-w-[7rem] px-3 sm:px-4 py-2 rounded-lg text-[11px] sm:text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                view === "admin" ? "bg-accent text-black shadow-lg" : "text-white/60 hover:text-white"
              }`}
            >
              <Sliders className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Administration
            </button>
          )}
        </div>
      </div>

      {/* Admin Toggles */}
      {isAdmin && view === "admin" && (
        <div className="bg-accent/10 border border-accent/20 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-accent">
            <Activity className="w-4 h-4 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">
              Administration Panel
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setAdminSubTab("merchandise");
                setShowAddMerch(false);
                setShowManualOrder(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition border ${
                adminSubTab === "merchandise"
                  ? "bg-accent text-black border-accent"
                  : "border-glass-border text-white hover:bg-white/5"
              }`}
            >
              Manage Products
            </button>
            <button
              onClick={() => {
                setAdminSubTab("orders");
                setShowAddMerch(false);
                setShowManualOrder(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition border ${
                adminSubTab === "orders"
                  ? "bg-accent text-black border-accent"
                  : "border-glass-border text-white hover:bg-white/5"
              }`}
            >
              All Customer Orders ({store.merchOrders.length})
            </button>
            {adminSubTab === "merchandise" && (
              <button
                onClick={() => {
                  setShowAddMerch(true);
                  setEditingMerch(null);
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> New Item
              </button>
            )}
            {adminSubTab === "orders" && (
              <>
                <button
                  onClick={() => {
                    setShowManualOrder(true);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Cash / Manual Order
                </button>
                <button
                  onClick={() => {
                    setShowReportModal(true);
                    setIsCopied(false);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-1.5 shadow-md shadow-emerald-950/25"
                >
                  <Share2 className="w-3.5 h-3.5" /> WhatsApp Report
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {view === "admin" && isAdmin && (
        <>
          {/* Admin Create / Edit form */}
          {adminSubTab === "merchandise" && showAddMerch && (
            <form
              onSubmit={handleCreateOrUpdateMerchandise}
              className="glass p-6 rounded-2xl border border-glass-border space-y-4"
            >
              <div className="flex items-center justify-between border-b border-glass-border pb-3">
                <h3 className="text-sm font-bold uppercase tracking-widest text-accent flex items-center gap-2">
                  <Sliders className="w-4 h-4" /> {editingMerch ? "Edit Product" : "Add New Merchandise"}
                </h3>
                <button
                  type="button"
                  onClick={resetMerchForm}
                  className="text-white/40 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Item Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={merchName}
                    onChange={(e) => setMerchName(e.target.value)}
                    placeholder="e.g. Premium Scarlet Jersey"
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Category *
                  </label>
                  <select
                    value={merchCategory}
                    onChange={(e) => setMerchCategory(e.target.value as any)}
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900"
                  >
                    <option value="Jersey">Jersey</option>
                    <option value="Pant">Pant</option>
                    <option value="Jacket">Jacket</option>
                    <option value="Sweater">Sweater</option>
                    <option value="Cap">Cap</option>
                    <option value="Cricket Gears">Cricket Gears</option>
                    <option value="Stickers">Stickers</option>
                    <option value="Others">Others</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Product Description
                  </label>
                  <textarea
                    value={merchDescription}
                    onChange={(e) => setMerchDescription(e.target.value)}
                    placeholder="Describe specifics, details, options..."
                    rows={2}
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Base Price (INR) *
                  </label>
                  <input
                    type="number"
                    required
                    value={merchBasePrice || ""}
                    onChange={(e) => setMerchBasePrice(Number(e.target.value))}
                    placeholder="999"
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Vendor MOQ (Min Order Qty) *
                  </label>
                  <input
                    type="number"
                    required
                    value={merchMinQty || ""}
                    onChange={(e) => setMerchMinQty(Number(e.target.value))}
                    placeholder="10"
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>

                <div className="md:col-span-2 space-y-4 border-t border-glass-border pt-4 mt-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="enableCustomAttributes"
                        checked={enableCustomAttributes}
                        onChange={(e) => setEnableCustomAttributes(e.target.checked)}
                        className="w-4.5 h-4.5 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent cursor-pointer"
                      />
                      <label htmlFor="enableCustomAttributes" className="text-sm font-bold text-white cursor-pointer select-none">
                        Enable Custom Attributes (e.g., Chest Size, Sleeve Option, Waist Size, Fit)
                      </label>
                    </div>

                    {enableCustomAttributes && (
                      <button
                        type="button"
                        onClick={handleAddCustomField}
                        className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded transition flex items-center gap-2"
                      >
                        <Plus className="w-3 h-3" /> Add Attribute
                      </button>
                    )}
                  </div>
                  
                  {enableCustomAttributes ? (
                    <div className="space-y-4">
                      {merchCustomFields.length === 0 && (
                        <div className="text-xs text-white/40 italic">
                          No custom attributes added yet. Click &quot;Add Attribute&quot; to define choices.
                        </div>
                      )}
                      {merchCustomFields.map((field, fieldIndex) => (
                        <div key={fieldIndex} className="bg-black/20 border border-white/10 p-4 rounded-lg space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                                Attribute Name
                              </label>
                              <input
                                type="text"
                                required
                                value={field.name}
                                onChange={(e) => handleUpdateCustomFieldName(fieldIndex, e.target.value)}
                                placeholder="e.g. Chest Size, Sleeve Option"
                                className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomField(fieldIndex)}
                              className="mt-5 text-red-400 hover:text-red-300 p-2"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="space-y-2">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                              Options
                            </label>
                            {field.options.map((opt, optIndex) => (
                              <div key={optIndex} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-white/5 p-2 rounded border border-white/5">
                                <input
                                  type="text"
                                  required
                                  value={opt.value}
                                  onChange={(e) => handleUpdateCustomFieldOption(fieldIndex, optIndex, { value: e.target.value })}
                                  placeholder="Option name (e.g. Full Sleeve)"
                                  className="flex-1 w-full sm:w-auto bg-black/40 border border-glass-border rounded px-3 py-1.5 text-xs focus:outline-none focus:border-accent text-white"
                                />
                                
                                <select
                                  value={opt.priceModifierType}
                                  onChange={(e) => handleUpdateCustomFieldOption(fieldIndex, optIndex, { priceModifierType: e.target.value as "None" | "Add", priceModifierValue: e.target.value === "None" ? undefined : opt.priceModifierValue })}
                                  className="w-full sm:w-auto bg-black/40 border border-glass-border rounded px-3 py-1.5 text-xs focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900"
                                >
                                  <option value="None">Keep Same Price</option>
                                  <option value="Add">Add INR</option>
                                </select>

                                {opt.priceModifierType === "Add" && (
                                  <input
                                    type="number"
                                    required
                                    value={opt.priceModifierValue || ""}
                                    onChange={(e) => handleUpdateCustomFieldOption(fieldIndex, optIndex, { priceModifierValue: Number(e.target.value) })}
                                    placeholder="Amount"
                                    className="w-full sm:w-24 bg-black/40 border border-glass-border rounded px-3 py-1.5 text-xs focus:outline-none focus:border-accent text-white"
                                  />
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleRemoveCustomFieldOption(fieldIndex, optIndex)}
                                  className="text-red-400/70 hover:text-red-400 p-1.5 shrink-0 ml-auto sm:ml-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => handleAddCustomFieldOption(fieldIndex)}
                              className="text-[10px] uppercase font-bold text-accent hover:text-accent/80 flex items-center gap-1 mt-2"
                            >
                              <Plus className="w-3 h-3" /> Add Option
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-black/20 p-4 border border-white/10 rounded-lg">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                          Sizes (Comma separated)
                        </label>
                        <input
                          type="text"
                          value={merchSizes}
                          onChange={(e) => setMerchSizes(e.target.value)}
                          placeholder="36, 38, 40, 42, 44, 46"
                          className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                          Specifications (Comma separated)
                        </label>
                        <input
                          type="text"
                          value={merchSpecs}
                          onChange={(e) => setMerchSpecs(e.target.value)}
                          placeholder="Half Sleeve, Full Sleeve"
                          className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Ordering Status *
                  </label>
                  <select
                    value={merchStatus}
                    onChange={(e) => setMerchStatus(e.target.value as any)}
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900"
                  >
                    <option value="Accepting Orders">Accepting Orders and Payments</option>
                    <option value="Not Accepting Orders">Not Accepting New Orders Yet</option>
                  </select>
                </div>

                <div className="flex flex-col gap-3 md:col-span-2">
                  <div className="flex items-center gap-3 bg-black/30 border border-glass-border rounded-lg px-4 py-3">
                    <input
                      type="checkbox"
                      id="merchIsHidden"
                      checked={merchIsHidden}
                      onChange={(e) => setMerchIsHidden(e.target.checked)}
                      className="w-4.5 h-4.5 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent cursor-pointer"
                    />
                    <div>
                      <label htmlFor="merchIsHidden" className="text-xs font-extrabold uppercase tracking-wider text-accent select-none cursor-pointer block">
                        Hide item from Shop
                      </label>
                      <span className="text-[10px] text-white/50">
                        When checked, players won't see this item. Only administrators can view, edit, and unhide it.
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-black/30 border border-glass-border rounded-lg px-4 py-3">
                    <input
                      type="checkbox"
                      id="merchRequirePlayerDetails"
                      checked={merchRequirePlayerDetails}
                      onChange={(e) => setMerchRequirePlayerDetails(e.target.checked)}
                      className="w-4.5 h-4.5 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent cursor-pointer"
                    />
                    <div>
                      <label htmlFor="merchRequirePlayerDetails" className="text-xs font-extrabold uppercase tracking-wider text-accent select-none cursor-pointer block">
                        Require Player Details (Jersey Name, Number, Sizes)
                      </label>
                      <span className="text-[10px] text-white/50">
                        If checked, ordering this item will prompt the player to enter or confirm their jersey name, number and other related details.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetMerchForm}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-accent text-black rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-accent/90 transition shadow-lg shadow-accent/20"
                >
                  {editingMerch ? "Save Changes" : "Create Item"}
                </button>
              </div>
            </form>
          )}

          {/* Admin Manual Cash Order entry */}
          {adminSubTab === "orders" && showManualOrder && (
            <form
              onSubmit={handleAddManualOrder}
              className="glass p-6 rounded-2xl border border-glass-border space-y-4 bg-blue-950/20"
            >
              <div className="flex items-center justify-between border-b border-glass-border pb-3">
                <h3 className="text-sm font-bold uppercase tracking-widest text-blue-400 flex items-center gap-2">
                  <UserPlus className="w-4 h-4" /> Create Manual Cash Order
                </h3>
                <button
                  type="button"
                  onClick={() => setShowManualOrder(false)}
                  className="text-white/40 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Select Player *
                  </label>
                  <select
                    required
                    value={manualPlayerId}
                    onChange={(e) => {
                      setManualPlayerId(e.target.value);
                      const pl = store.players.find((p) => p.id === e.target.value);
                      if (pl) {
                        setManualJerseyName(pl.name);
                        setManualJerseyNumber(pl.jerseyNumber || "");
                        setManualSize(pl.chestSize || "");
                      }
                    }}
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900"
                  >
                    <option value="">-- Choose Player --</option>
                    {store.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.mobile})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Select Item *
                  </label>
                  <select
                    required
                    value={manualMerchId}
                    onChange={(e) => {
                      setManualMerchId(e.target.value);
                      const prod = store.merchandises.find((m) => m.id === e.target.value);
                      if (prod) {
                        setManualPrice(prod.basePrice);
                        setManualSize(prod.sizes[0] || "");
                        setManualSpec(prod.specs[0] || "");
                      }
                    }}
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900"
                  >
                    <option value="">-- Choose Item --</option>
                    {store.merchandises.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} (₹{m.basePrice})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Order Price Override (INR)
                  </label>
                  <input
                    type="number"
                    value={manualPrice || ""}
                    onChange={(e) => setManualPrice(Number(e.target.value))}
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>

                {(() => {
                  const selectedProductForManual = store.merchandises.find((m) => m.id === manualMerchId);
                  if (selectedProductForManual?.customFields && selectedProductForManual.customFields.length > 0) {
                    return (
                      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {selectedProductForManual.customFields.map((field) => (
                          <div key={field.name}>
                            <label htmlFor={`manualSelect-${field.name}`} className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                              {field.name} *
                            </label>
                            <select
                              id={`manualSelect-${field.name}`}
                              required
                              value={manualCustomSelections[field.name] || ""}
                              onChange={(e) => {
                                setManualCustomSelections({
                                  ...manualCustomSelections,
                                  [field.name]: e.target.value
                                });
                              }}
                              className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900 font-semibold"
                            >
                              <option value="">-- Choose {field.name} --</option>
                              {field.options.map((opt) => {
                                const addition = opt.priceModifierType === "Add" && opt.priceModifierValue 
                                  ? ` (+₹${opt.priceModifierValue})` 
                                  : "";
                                return (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.value}{addition}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <>
                      {manualMerchId && (store.merchandises.find((m: any) => m.id === manualMerchId)?.sizes?.length ?? 0) > 0 && (
                        <div>
                          <label htmlFor="manualSizeSelect" className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                            Size *
                          </label>
                          <select
                            id="manualSizeSelect"
                            required
                            value={manualSize}
                            onChange={(e) => setManualSize(e.target.value)}
                            className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900 font-mono"
                          >
                            <option value="">-- Choose Size --</option>
                            {store.merchandises.find((m: any) => m.id === manualMerchId)?.sizes?.map((s: string) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {manualMerchId && (store.merchandises.find((m: any) => m.id === manualMerchId)?.specs?.length ?? 0) > 0 && (
                        <div>
                          <label htmlFor="manualSpecSelect" className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                            Specification *
                          </label>
                          <select
                            id="manualSpecSelect"
                            value={manualSpec}
                            onChange={(e) => setManualSpec(e.target.value)}
                            className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900 font-semibold"
                          >
                            <option value="">-- Choose Specification --</option>
                            {store.merchandises.find((m: any) => m.id === manualMerchId)?.specs?.map((sp: string) => (
                              <option key={sp} value={sp}>
                                {sp}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  );
                })()}

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Cash Payment Status *
                  </label>
                  <select
                    value={manualPaidStatus}
                    onChange={(e) => setManualPaidStatus(e.target.value as any)}
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900"
                  >
                    <option value="Paid">Paid Upfront</option>
                    <option value="Unpaid">Unpaid / Cash Awaiting</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Jersey Print Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={manualJerseyName}
                    onChange={(e) => setManualJerseyName(e.target.value)}
                    placeholder="Back print"
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Jersey Number (Optional)
                  </label>
                  <input
                    type="text"
                    value={manualJerseyNumber}
                    onChange={(e) => setManualJerseyNumber(e.target.value)}
                    placeholder="Back number"
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualOrder(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingManualOrder}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-blue-500 transition shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingManualOrder ? "Saving..." : "Save Manual Cash Order"}
                </button>
              </div>
            </form>
          )}

          {/* Admin All Orders Management list */}
          {adminSubTab === "orders" ? (
            <div className="glass rounded-2xl border border-glass-border p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-glass-border pb-3">
                <h3 className="text-sm font-bold uppercase tracking-widest text-accent flex items-center gap-2">
                  <Package className="w-4 h-4" /> Global Customer Orders List
                </h3>
              </div>

              {store.merchOrders.length === 0 ? (
                <div className="text-center py-10 text-white/40 text-sm">
                  No orders have been placed in the shop yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-glass-border text-white/50 uppercase tracking-widest text-[9px] font-black">
                        <th className="py-3 px-2">Player</th>
                        <th className="py-3 px-2">Item Ordered</th>
                        <th className="py-3 px-2">Size / Spec</th>
                        <th className="py-3 px-2">Jersey Name/Num</th>
                        <th className="py-3 px-2 text-right">Price</th>
                        <th className="py-3 px-2 text-center">Payment</th>
                        <th className="py-3 px-2 text-center">Fulfilment Status</th>
                        <th className="py-3 px-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border text-white/90">
                      {store.merchOrders.map((ord) => {
                        // Legacy orders may store size inside customSelections
                        // ("Chest Size" / "Size" custom field) instead of the
                        // top-level `size` column. Prefer top-level, fall back.
                        const displaySize = ord.size || Object.entries(ord.customSelections || {}).find(([k]) => {
                          const kl = k.toLowerCase();
                          return kl.includes("chest") || kl === "size";
                        })?.[1] || "";
                        return (
                        <tr key={ord.id} className="hover:bg-white/5 transition">
                          <td className="py-3.5 px-2 font-bold whitespace-nowrap">{ord.playerName}</td>
                          <td className="py-3.5 px-2">
                            <span className="font-semibold text-accent">{ord.merchName}</span>
                            {ord.isManual && (
                              <span className="ml-1.5 px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded text-[9px] uppercase tracking-wider font-bold whitespace-nowrap">
                                Cash Manual
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-2 whitespace-nowrap">
                            {displaySize ? (
                              <span className="bg-white/10 px-2 py-0.5 rounded font-mono font-bold">
                                {displaySize}
                              </span>
                            ) : (
                              <span className="text-white/30">—</span>
                            )}
                            {ord.spec && (
                              <span className="ml-1.5 text-white/60 font-semibold">{ord.spec}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-2 whitespace-nowrap">
                            {ord.jerseyName ? (
                              <div className="font-mono text-white/80">
                                <span className="font-bold text-emerald-400">{ord.jerseyName}</span>
                                <span className="text-white/50 ml-1">#{ord.jerseyNumber}</span>
                              </div>
                            ) : (
                              <span className="text-white/30">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-2 text-right font-mono font-bold text-accent whitespace-nowrap">
                            ₹{ord.price}
                          </td>
                          <td className="py-3.5 px-2 text-center">
                            <select
                              value={ord.paymentStatus}
                              onChange={(e) => handleUpdateOrderPaymentStatus(ord.id, e.target.value as any)}
                              className={`bg-black/60 border border-glass-border rounded px-2 py-1 text-[10px] font-bold focus:outline-none ${
                                ord.paymentStatus === "Paid" ? "text-emerald-400" : "text-amber-400"
                              }`}
                            >
                              <option value="Paid">Paid</option>
                              <option value="Unpaid">Unpaid</option>
                            </select>
                          </td>
                          <td className="py-3.5 px-2 text-center">
                            <select
                              value={ord.orderStatus}
                              onChange={(e) => handleUpdateOrderStatus(ord.id, e.target.value as any)}
                              className="bg-black/60 border border-glass-border rounded px-2 py-1 text-[10px] font-bold text-white focus:outline-none whitespace-nowrap"
                            >
                              <option value="Order Placed">Order Placed</option>
                              <option value="Awaiting Min Order Qnty">Awaiting Min Order Qnty</option>
                              <option value="Ready to Place Order">Ready to Place Order</option>
                              <option value="Order Received">Order Received</option>
                              <option value="Fulfilled">Fulfilled</option>
                            </select>
                          </td>
                          <td className="py-3.5 px-2 text-right whitespace-nowrap">
                            <button
                              onClick={() => openEditOrder(ord)}
                              className="text-accent hover:text-accent/80 transition p-1 mr-1"
                              title="Edit Order"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteOrder(ord)}
                              className="text-red-400 hover:text-red-300 transition p-1"
                              title="Delete Order"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* Admin Catalog (Products list) */
            <div className="space-y-4">
              {store.merchandises.length === 0 ? (
                <div className="glass p-10 text-center rounded-2xl border border-glass-border space-y-3">
                  <ShoppingBag className="w-12 h-12 text-white/20 mx-auto" />
                  <p className="text-white/50 text-sm">No merchandise items configured yet.</p>
                  {isAdmin && (
                    <button
                      onClick={() => setShowAddMerch(true)}
                      className="px-4 py-2 bg-accent text-black font-bold uppercase tracking-wider text-xs rounded-lg hover:bg-accent/90 transition"
                    >
                      Configure First Item
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {store.merchandises
                    .map((merch) => {
                      const paidCount = getPaidOrdersCount(merch.id);
                      const moq = merch.minOrderQuantity || 1;
                      const pct = Math.min(100, Math.round((paidCount / moq) * 100));
                      const isAccepting = merch.status === "Accepting Orders";

                      return (
                        <div
                          key={merch.id}
                          className={`glass rounded-2xl border overflow-hidden flex flex-col justify-between group hover:border-accent/40 transition-all duration-300 ${
                            merch.isHidden ? "border-red-900/30 bg-red-950/5" : "border-glass-border"
                          }`}
                        >
                          {/* Top banner / Image placeholder */}
                          <div className="h-28 bg-gradient-to-br from-emerald-950/80 to-stone-900/80 p-4 flex flex-col justify-between border-b border-glass-border">
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-1.5">
                                <span className="px-2 py-0.5 bg-accent/20 border border-accent/30 text-accent font-mono text-[9px] uppercase tracking-widest font-black rounded-md">
                                  {merch.category}
                                </span>
                                {merch.isHidden && (
                                  <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/30 text-red-400 font-mono text-[9px] uppercase tracking-widest font-black rounded-md">
                                    Hidden
                                  </span>
                                )}
                              </div>
                            
                              <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                                <button
                                  onClick={() => handleEditMerchandise(merch)}
                                  className="p-1 bg-black/40 rounded text-amber-400 hover:text-amber-300 transition"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteMerchandise(merch.id)}
                                  className="p-1 bg-black/40 rounded text-red-400 hover:text-red-300 transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                          </div>

                          <div>
                            <h3 className="font-extrabold uppercase text-white tracking-wide text-md">
                              {merch.name}
                            </h3>
                            <p className="text-[10px] text-white/50 truncate">
                              {merch.description || "Official Kavach club apparel"}
                            </p>
                          </div>
                        </div>

                        {/* Middle: Details & MOQ tracking */}
                        <div className="p-5 space-y-4">
                          {/* Price */}
                          <div className="flex items-end justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                              Price
                            </span>
                            <span className="text-xl font-mono font-black text-accent">
                              ₹{merch.basePrice}
                            </span>
                          </div>

                          {/* MOQ Progress bar */}
                          <div className="space-y-1.5 border-t border-glass-border pt-3">
                            <div className="flex justify-between text-[10px] font-bold tracking-wider">
                              <span className="text-white/50 uppercase">Vendor Goal Target</span>
                              <span className={`${pct >= 100 ? "text-emerald-400" : "text-amber-400"}`}>
                                {paidCount} / {moq} Ordered ({pct}%)
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ${
                                  pct >= 100 ? "bg-emerald-400" : "bg-amber-400"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {view === "catalog" && (
        /* Player Catalog (Products list) */
        <div className="space-y-4">
          {store.merchandises.filter((m) => isAdmin || !m.isHidden).length === 0 ? (
            <div className="glass p-10 text-center rounded-2xl border border-glass-border space-y-3">
              <ShoppingBag className="w-12 h-12 text-white/20 mx-auto" />
              <p className="text-white/50 text-sm">No merchandise items configured yet.</p>
              {isAdmin && (
                <button
                  onClick={() => {
                    setView("admin");
                    setAdminSubTab("merchandise");
                    setShowAddMerch(true);
                  }}
                  className="px-4 py-2 bg-accent text-black font-bold uppercase tracking-wider text-xs rounded-lg hover:bg-accent/90 transition"
                >
                  Configure First Item
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {store.merchandises
                .filter((m) => isAdmin || !m.isHidden)
                .map((merch) => {
                  const paidCount = getPaidOrdersCount(merch.id);
                  const moq = merch.minOrderQuantity || 1;
                  const pct = Math.min(100, Math.round((paidCount / moq) * 100));
                  const isAccepting = merch.status === "Accepting Orders";

                  return (
                    <div
                      key={merch.id}
                      className={`glass rounded-2xl border overflow-hidden flex flex-col justify-between group hover:border-accent/40 transition-all duration-300 ${
                        merch.isHidden ? "border-red-900/30 bg-red-950/5" : "border-glass-border"
                      }`}
                    >
                      {/* Top banner / Image placeholder */}
                      <div className="h-28 bg-gradient-to-br from-emerald-950/80 to-stone-900/80 p-4 flex flex-col justify-between border-b border-glass-border">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 bg-accent/20 border border-accent/30 text-accent font-mono text-[9px] uppercase tracking-widest font-black rounded-md">
                              {merch.category}
                            </span>
                            {merch.isHidden && (
                              <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/30 text-red-400 font-mono text-[9px] uppercase tracking-widest font-black rounded-md">
                                Hidden
                              </span>
                            )}
                          </div>
                        </div>

                        <div>
                          <h3 className="font-extrabold uppercase text-white tracking-wide text-md">
                            {merch.name}
                          </h3>
                          <p className="text-[10px] text-white/50 truncate">
                            {merch.description || "Official Kavach club apparel"}
                          </p>
                        </div>
                      </div>

                      {/* Middle: Details & MOQ tracking */}
                      <div className="p-5 space-y-4">
                        {/* Price */}
                        <div className="flex items-end justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                            Price
                          </span>
                          <span className="text-xl font-mono font-black text-accent">
                            ₹{merch.basePrice}
                          </span>
                        </div>

                        {/* MOQ Progress bar */}
                        <div className="space-y-1.5 border-t border-glass-border pt-3">
                          <div className="flex justify-between text-[10px] font-bold tracking-wider">
                            <span className="text-white/50 uppercase">Vendor Goal Target</span>
                            <span className={`${pct >= 100 ? "text-emerald-400" : "text-amber-400"}`}>
                              {paidCount} / {moq} Ordered ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 bg-black/60 rounded-full overflow-hidden border border-white/5">
                            <div
                              style={{ width: `${pct}%` }}
                              className={`h-full rounded-full transition-all duration-500 ${
                                pct >= 100
                                  ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                                  : "bg-gradient-to-r from-amber-500 to-accent"
                              }`}
                            />
                          </div>
                          <div className="flex justify-between text-[9px] font-medium text-white/40">
                            <span>Min Vendor MOQ: {moq}</span>
                            {pct >= 100 ? (
                              <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                                <CheckCircle className="w-2.5 h-2.5" /> Ready to process order
                              </span>
                            ) : (
                              <span>Awaiting minimum order goal</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Bottom checkout option */}
                      <div className="p-5 pt-0">
                        {isAccepting ? (
                          <button
                            onClick={() => openOrderModal(merch)}
                            className="w-full bg-accent hover:bg-accent/90 text-black py-2.5 rounded-xl font-bold uppercase tracking-widest text-xs transition shadow-lg shadow-accent/10 hover:scale-[1.01]"
                          >
                            Order Product
                          </button>
                        ) : (
                          <div className="text-center py-2 bg-red-950/30 border border-red-900/30 text-red-400 rounded-xl text-xs font-bold uppercase tracking-wider">
                            Not Accepting New Orders Yet
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {view === "history" && (
        <div className="glass rounded-2xl border border-glass-border p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-glass-border pb-3">
            <h3 className="text-sm font-bold uppercase tracking-widest text-accent flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" /> My Personal Purchases & History
            </h3>
          </div>

          {myOrders.length === 0 ? (
            <div className="text-center py-10 text-white/40 text-sm space-y-2">
              <p>You haven't placed any merchandise orders yet.</p>
              <button
                onClick={() => setView("catalog")}
                className="px-4 py-1.5 bg-accent/20 border border-accent/30 text-accent text-xs font-bold uppercase tracking-widest rounded-lg"
              >
                Browse Shop Menu
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-glass-border text-white/50 uppercase tracking-widest text-[9px] font-black">
                    <th className="py-3 px-2">Item</th>
                    <th className="py-3 px-2">Size Selected</th>
                    <th className="py-3 px-2">Specifications</th>
                    <th className="py-3 px-2">Jersey Print details</th>
                    <th className="py-3 px-2 text-right">Cost Paid</th>
                    <th className="py-3 px-2 text-center">Payment Status</th>
                    <th className="py-3 px-2 text-center">Fulfillment Tracker</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-glass-border text-white/90">
                  {myOrders.map((o) => {
                    const displaySize = o.size || Object.entries(o.customSelections || {}).find(([k]) => {
                      const kl = k.toLowerCase();
                      return kl.includes("chest") || kl === "size";
                    })?.[1] || "";
                    return (
                    <tr key={o.id} className="hover:bg-white/5 transition">
                      <td className="py-3.5 px-2 font-bold text-accent whitespace-nowrap">{o.merchName}</td>
                      <td className="py-3.5 px-2 whitespace-nowrap">
                        {displaySize ? (
                          <span className="bg-white/10 px-2 py-0.5 rounded font-mono font-bold">
                            {displaySize}
                          </span>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-2 font-semibold text-white/70 whitespace-nowrap">
                        {o.spec || "Standard / None"}
                      </td>
                      <td className="py-3.5 px-2 whitespace-nowrap">
                        {o.jerseyName ? (
                          <div className="font-mono text-white/80">
                            <span className="font-bold text-emerald-400">{o.jerseyName}</span>
                            <span className="text-white/50 ml-1">#{o.jerseyNumber}</span>
                          </div>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-2 text-right font-mono font-bold whitespace-nowrap">
                        ₹{o.price}
                      </td>
                      <td className="py-3.5 px-2 text-center">
                        <span className="px-2 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-900/50 rounded-full text-[10px] uppercase font-bold tracking-wider whitespace-nowrap inline-block">
                          {o.paymentStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-2 text-center">
                        <span
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 whitespace-nowrap ${
                            o.orderStatus === "Fulfilled"
                              ? "bg-emerald-950/60 text-emerald-400 border border-emerald-900/50"
                              : o.orderStatus === "Ready to Place Order" || o.orderStatus === "Order Received"
                              ? "bg-blue-950/60 text-blue-400 border border-blue-900/50"
                              : "bg-amber-950/60 text-amber-400 border border-amber-900/50"
                          }`}
                        >
                          {o.orderStatus === "Fulfilled" && <CheckCircle className="w-3 h-3" />}
                          {o.orderStatus === "Order Placed" && <Clock className="w-3 h-3" />}
                          {o.orderStatus === "Awaiting Min Order Qnty" && <Clock className="w-3 h-3 animate-pulse" />}
                          {o.orderStatus === "Ready to Place Order" && <Sparkles className="w-3 h-3" />}
                          {o.orderStatus}
                        </span>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === "global-list" && (
        <div className="space-y-6">
          <div className="glass p-5 rounded-2xl border border-glass-border space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-glass-border pb-4">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-accent flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Consolidated Club Orders & Delivery Sheet
                </h3>
                <p className="text-[11px] text-white/50 mt-1">
                  View sizes, backprints, and specifications grouped by item. Perfect for vendor orders and team management.
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    setShowReportModal(true);
                    setIsCopied(false);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/40"
                >
                  <Share2 className="w-4 h-4" /> Generate WhatsApp Report
                </button>
              </div>
            </div>

            {/* Grouped Products list */}
            {store.merchandises.length === 0 && store.merchOrders.length === 0 ? (
              <div className="text-center py-10 text-white/40 text-sm">
                No products configured and no orders placed yet.
              </div>
            ) : (
              <div className="space-y-8">
                {store.merchandises.map((merch) => {
                  const merchOrders = store.merchOrders.filter((o) => o.merchId === merch.id);
                  return (
                    <div key={merch.id} className="space-y-3 bg-white/5 border border-glass-border/60 rounded-xl p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-glass-border pb-2.5">
                        <div className="space-y-1">
                          <h4 className="text-sm font-black uppercase text-accent tracking-wide">{merch.name}</h4>
                          <span className="inline-block text-[10px] font-mono font-bold uppercase tracking-wider text-white/40">
                            Category: {merch.category} | MOQ Goal: {merch.minOrderQuantity}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] bg-accent/15 border border-accent/30 text-accent font-mono font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                            Paid: {merchOrders.filter(o => o.paymentStatus === 'Paid').length}
                          </span>
                          <span className="text-[10px] bg-white/10 border border-white/20 text-white font-mono font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                            Total: {merchOrders.length}
                          </span>
                        </div>
                      </div>

                      {merchOrders.length === 0 ? (
                        <p className="text-[11px] text-white/40 py-2 italic">No orders placed for this item yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-glass-border/35 text-white/40 uppercase tracking-widest text-[9px] font-black">
                                <th className="py-2 px-1">Player Name</th>
                                <th className="py-2 px-1">Size</th>
                                <th className="py-2 px-1">Specification</th>
                                {merch.category === "Jersey" && (
                                  <>
                                    <th className="py-2 px-1">Sleeve</th>
                                    <th className="py-2 px-1">Backprint Name</th>
                                    <th className="py-2 px-1">Jersey Number</th>
                                  </>
                                )}
                                <th className="py-2 px-1 text-right">Price Paid</th>
                                <th className="py-2 px-1 text-center">Payment Status</th>
                                <th className="py-2 px-1 text-center">Fulfillment Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-glass-border/20 text-white/80">
                              {merchOrders.map((ord) => {
                                const displaySize = ord.size || Object.entries(ord.customSelections || {}).find(([k]) => {
                                  const kl = k.toLowerCase();
                                  return kl.includes("chest") || kl === "size";
                                })?.[1] || "";
                                // Sleeves for Jerseys come in either through
                                // the top-level `spec` field or (more often)
                                // as a customSelections entry whose key
                                // contains "sleeve".
                                const displaySleeve = Object.entries(ord.customSelections || {}).find(([k]) =>
                                  k.toLowerCase().includes("sleeve"),
                                )?.[1] || (ord.spec && ord.spec.toLowerCase().includes("sleeve") ? ord.spec : "") || "";
                                return (
                                <tr key={ord.id} className="hover:bg-white/5 transition">
                                  <td className="py-2.5 px-1 font-bold whitespace-nowrap">{ord.playerName}</td>
                                  <td className="py-2.5 px-1 whitespace-nowrap">
                                    {displaySize ? (
                                      <span className="bg-white/10 px-2 py-0.5 rounded font-mono font-bold text-[10px]">
                                        {displaySize}
                                      </span>
                                    ) : (
                                      <span className="text-white/30">—</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-1 font-semibold text-white/60 whitespace-nowrap">{ord.spec || "Standard"}</td>
                                  {merch.category === "Jersey" && (
                                    <>
                                      <td className="py-2.5 px-1 whitespace-nowrap">
                                        {displaySleeve ? (
                                          <span className="bg-sky-500/15 text-sky-300 px-2 py-0.5 rounded font-mono font-bold text-[10px]">
                                            {displaySleeve}
                                          </span>
                                        ) : (
                                          <span className="text-white/30">—</span>
                                        )}
                                      </td>
                                      <td className="py-2.5 px-1 font-mono font-extrabold text-emerald-400 uppercase whitespace-nowrap">{ord.jerseyName || "—"}</td>
                                      <td className="py-2.5 px-1 font-mono font-extrabold text-accent whitespace-nowrap">
                                        {ord.jerseyNumber ? `#${ord.jerseyNumber}` : "—"}
                                      </td>
                                    </>
                                  )}
                                  <td className="py-2.5 px-1 text-right font-mono font-black text-accent text-[11px] whitespace-nowrap">₹{ord.price}</td>
                                  <td className="py-2.5 px-1 text-center">
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold tracking-wider border whitespace-nowrap inline-block ${
                                      ord.paymentStatus === 'Paid'
                                        ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/40'
                                        : 'bg-amber-950/40 text-amber-400 border-amber-900/40'
                                    }`}>
                                      {ord.paymentStatus}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-1 text-center whitespace-nowrap">
                                    <span className="text-[10px] font-bold text-white/70">{ord.orderStatus}</span>
                                  </td>
                                </tr>
                              );})}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin Edit Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0f172a] border border-glass-border rounded-xl w-full max-w-lg p-5 relative shadow-2xl max-h-[90vh] overflow-y-auto">
            <button
              onClick={closeEditOrder}
              className="absolute top-4 right-4 text-white/50 hover:text-white transition"
              disabled={isSavingEditOrder}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold uppercase tracking-widest text-accent mb-1 flex items-center gap-2">
              <Edit className="w-4 h-4" /> Edit Order
            </h3>
            <p className="text-[11px] text-white/60 mb-4">
              {editingOrder.playerName} · {editingOrder.merchName}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Size
                </label>
                <input
                  type="text"
                  value={editOrderDraft.size ?? ""}
                  onChange={(e) =>
                    setEditOrderDraft((prev) => ({ ...prev, size: e.target.value }))
                  }
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Specification
                </label>
                <input
                  type="text"
                  value={editOrderDraft.spec ?? ""}
                  onChange={(e) =>
                    setEditOrderDraft((prev) => ({ ...prev, spec: e.target.value }))
                  }
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Jersey Name
                </label>
                <input
                  type="text"
                  value={editOrderDraft.jerseyName ?? ""}
                  onChange={(e) =>
                    setEditOrderDraft((prev) => ({
                      ...prev,
                      jerseyName: e.target.value,
                    }))
                  }
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white uppercase font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Jersey Number
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  value={editOrderDraft.jerseyNumber ?? ""}
                  onChange={(e) =>
                    setEditOrderDraft((prev) => ({
                      ...prev,
                      jerseyNumber: e.target.value.replace(/\D/g, "").slice(0, 3),
                    }))
                  }
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Price (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editOrderDraft.price ?? 0}
                  onChange={(e) =>
                    setEditOrderDraft((prev) => ({
                      ...prev,
                      price: Number(e.target.value),
                    }))
                  }
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/50 block mb-1">
                  Payment Status
                </label>
                <select
                  value={editOrderDraft.paymentStatus ?? "Unpaid"}
                  onChange={(e) =>
                    setEditOrderDraft((prev) => ({
                      ...prev,
                      paymentStatus: e.target.value as "Paid" | "Unpaid",
                    }))
                  }
                  className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white [&>option]:bg-neutral-900"
                >
                  <option value="Paid">Paid</option>
                  <option value="Unpaid">Unpaid</option>
                </select>
              </div>
            </div>

            {Object.keys(editOrderCustomDraft).length > 0 && (
              <>
                <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-white/50">
                  Custom Attributes (Sleeves, etc.)
                </div>
                <div className="space-y-2 mb-3">
                  {Object.entries(editOrderCustomDraft).map(([key, val]) => (
                    <div key={key} className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-[11px] text-white/70 font-mono truncate col-span-1">
                        {key}
                      </span>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) =>
                          setEditOrderCustomDraft((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        className="col-span-2 w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeEditOrder}
                disabled={isSavingEditOrder}
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-white text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditOrder}
                disabled={isSavingEditOrder}
                className="flex-[2] py-2.5 rounded-lg bg-accent text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition disabled:opacity-50"
              >
                {isSavingEditOrder ? "Saving..." : "Save Order Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="glass w-full max-w-lg border border-glass-border rounded-2xl overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-emerald-950 to-neutral-900 px-5 py-4 flex items-center justify-between border-b border-glass-border">
              <div>
                <span className="text-[9px] font-black tracking-widest text-emerald-400 uppercase font-mono">
                  Vendor Report Generator
                </span>
                <h3 className="font-extrabold uppercase text-white text-md tracking-wide">
                  WhatsApp Report Preview
                </h3>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-white/40 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-[11px] text-white/60">
                Below is the formatted text compiled specifically for copy-pasting directly into WhatsApp chats with your players group or production vendor.
              </p>

              <textarea
                readOnly
                value={getWhatsAppReportText()}
                className="w-full h-80 bg-black/50 border border-glass-border rounded-xl p-3 text-xs font-mono text-emerald-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 overflow-y-auto"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="w-1/3 bg-white/5 hover:bg-white/10 text-white py-2.5 rounded-xl font-bold uppercase tracking-wider text-xs transition border border-glass-border"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleCopyWhatsAppReport}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl font-extrabold uppercase tracking-widest text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50"
                >
                  {isCopied ? <Check className="w-4 h-4 text-emerald-200" /> : <Copy className="w-4 h-4" />}
                  {isCopied ? "Copied!" : "Copy Report to Clipboard"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customize & Checkout Modal Dialog for Players */}
      {selectedMerch && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass w-full max-w-md border border-glass-border rounded-2xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-950 to-neutral-900 px-5 py-4 flex items-center justify-between border-b border-glass-border">
              <div>
                <span className="text-[9px] font-black tracking-widest text-accent uppercase font-mono">
                  Customise & Checkout
                </span>
                <h3 className="font-extrabold uppercase text-white text-md tracking-wide">
                  {selectedMerch.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedMerch(null)}
                className="text-white/40 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <div className="p-5 space-y-4">
              {selectedMerch.customFields && selectedMerch.customFields.length > 0 ? (
                <>
                  {selectedMerch.customFields.map((field) => (
                    <div key={field.name}>
                      <label htmlFor={`orderSelect-${field.name}`} className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1.5">
                        {field.name} *
                      </label>
                      <select
                        id={`orderSelect-${field.name}`}
                        value={orderCustomSelections[field.name] || ""}
                        onChange={(e) => {
                          setOrderCustomSelections({
                            ...orderCustomSelections,
                            [field.name]: e.target.value
                          });
                        }}
                        className="w-full bg-black/60 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white font-semibold [&>option]:bg-neutral-900"
                      >
                        <option value="" disabled>-- Select {field.name} --</option>
                        {field.options.map((opt) => {
                          const addition = opt.priceModifierType === "Add" && opt.priceModifierValue 
                            ? ` (+₹${opt.priceModifierValue})` 
                            : "";
                          return (
                            <option key={opt.value} value={opt.value}>
                              {opt.value}{addition}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {/* Selector for Sizes */}
                  {selectedMerch.sizes && selectedMerch.sizes.length > 0 && (
                    <div>
                      <label htmlFor="orderSizeSelect" className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1.5">
                        Choose Size *
                      </label>
                      <select
                        id="orderSizeSelect"
                        value={orderSize}
                        onChange={(e) => setOrderSize(e.target.value)}
                        className="w-full bg-black/60 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white font-mono [&>option]:bg-neutral-900"
                      >
                        <option value="" disabled>-- Select Size --</option>
                        {selectedMerch.sizes.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Selector for Specs */}
                  {selectedMerch.specs && selectedMerch.specs.length > 0 && (
                    <div>
                      <label htmlFor="orderSpecSelect" className="block text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1.5">
                        Specification *
                      </label>
                      <select
                        id="orderSpecSelect"
                        value={orderSpec}
                        onChange={(e) => setOrderSpec(e.target.value)}
                        className="w-full bg-black/60 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white font-semibold [&>option]:bg-neutral-900"
                      >
                        <option value="" disabled>-- Select Specification --</option>
                        {selectedMerch.specs.map((sp) => (
                          <option key={sp} value={sp}>
                            {sp}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* Jersey customisation details */}
              {(selectedMerch.category === "Jersey" || selectedMerch.requirePlayerDetails) ? (
                <div className="space-y-3 bg-white/5 p-4 rounded-xl border border-glass-border">
                  <div className="flex items-center justify-between gap-1 text-accent text-xs font-bold uppercase tracking-wider mb-1">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" /> Backprint Personalisation
                    </span>
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1">
                      Print Name on Back
                    </label>
                    <input
                      type="text"
                      maxLength={15}
                      value={customJerseyName}
                      onChange={(e) => setCustomJerseyName(e.target.value.toUpperCase())}
                      placeholder="e.g. DHONI"
                      className="w-full bg-black/60 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white uppercase font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1">
                      Jersey Number (Blocked: 10)
                    </label>
                    <input
                      type="text"
                      maxLength={3}
                      value={customJerseyNumber}
                      onChange={(e) => setCustomJerseyNumber(e.target.value.replace(/\D/g, ""))}
                      placeholder="e.g. 7"
                      className="w-full bg-black/60 border border-glass-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent text-white font-mono"
                    />
                    {customJerseyNumber === "10" && (
                      <p className="text-red-400 font-bold text-[10px] mt-1 flex items-center gap-0.5 animate-pulse">
                        <AlertTriangle className="w-3 h-3" /> Jersey number 10 is reserved and blocked!
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 p-3 rounded-xl text-[10px] text-white/50 flex items-center gap-2">
                  <User className="w-4 h-4 text-accent shrink-0" />
                  Your size choice will automatically be saved to your profile upon checkout.
                </div>
              )}

              {/* Price Calculation */}
              <div className="border-t border-glass-border pt-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                    Total Amount Due
                  </span>
                  <div className="text-xl font-mono font-black text-accent">
                    ₹{selectedMerch.basePrice + (selectedMerch.customFields?.reduce((acc, field) => {
                      const val = orderCustomSelections[field.name];
                      const opt = field.options.find(o => o.value === val);
                      return acc + (opt && opt.priceModifierType === "Add" && opt.priceModifierValue ? opt.priceModifierValue : 0);
                    }, 0) || 0)}
                  </div>
                </div>

                <div className="text-[10px] text-white/40 font-semibold text-right">
                  Upfront Collection via UPI/Admin
                </div>
              </div>

              {/* Checkout Actions */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={isOrdering || ((selectedMerch.category === "Jersey" || selectedMerch.requirePlayerDetails) && customJerseyNumber === "10")}
                  onClick={handlePlaceOrder}
                  className="w-full bg-accent disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 text-black py-3 rounded-xl font-extrabold uppercase tracking-widest text-xs transition flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  {isOrdering ? "Ordering..." : "Pay Upfront & Placed Order"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
